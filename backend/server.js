import express from 'express'
import cors from 'cors'
import { createClient } from 'redis'
import os from 'os'
import { networkInterfaces } from 'os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const app = express()
const port = process.env.PORT || 3001
const redisHost = process.env.REDIS_HOST || 'localhost'
const redisPort = parseInt(process.env.REDIS_PORT) || 6379
const version = '1.0.0'
const execFileAsync = promisify(execFile)
const kubeNamespace = process.env.POD_NAMESPACE || 'default'
const kubeHost = process.env.KUBERNETES_SERVICE_HOST
const kubePort = process.env.KUBERNETES_SERVICE_PORT || '443'

app.use(cors())
app.use(express.json())

let redis = null
let redisConnected = false

const labConfig = {
  failureRate: 0,
  artificialDelayMs: 0,
}

let requestMetrics = {
  startedAt: Date.now(),
  totalRequests: 0,
  totalErrors: 0,
  totalLatencyMs: 0,
  routes: {},
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const safeJsonParse = (value, fallback = null) => {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

const parseCpuToMillicores = (value) => {
  if (!value) {
    return 0
  }
  if (value.endsWith('n')) {
    return Number(value.slice(0, -1)) / 1_000_000
  }
  if (value.endsWith('u')) {
    return Number(value.slice(0, -1)) / 1000
  }
  if (value.endsWith('m')) {
    return Number(value.slice(0, -1))
  }
  return Number(value) * 1000
}

const parseMemoryToMiB = (value) => {
  if (!value) {
    return 0
  }

  const memoryUnits = {
    Ki: 1 / 1024,
    Mi: 1,
    Gi: 1024,
    Ti: 1024 * 1024,
    K: 1 / (1000 * 1.048576),
    M: 1 / 1.048576,
    G: 1000 / 1.048576,
  }

  const match = value.match(/^([0-9.]+)([A-Za-z]+)?$/)
  if (!match) {
    return 0
  }

  const amount = Number(match[1])
  const unit = match[2] || 'Mi'
  const multiplier = memoryUnits[unit] || 1
  return Number((amount * multiplier).toFixed(2))
}

const buildKubeHeaders = async () => {
  const tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token'
  const certPath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'
  const fs = await import('node:fs/promises')
  const [token, cert] = await Promise.all([
    fs.readFile(tokenPath, 'utf8'),
    fs.readFile(certPath, 'utf8'),
  ])

  return {
    token: token.trim(),
    cert,
  }
}

const fetchKubeJson = async (path) => {
  const https = await import('node:https')
  const { token, cert } = await buildKubeHeaders()

  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: kubeHost,
      port: kubePort,
      path,
      method: 'GET',
      ca: cert,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    }, (response) => {
      let body = ''

      response.on('data', (chunk) => {
        body += chunk
      })

      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Kubernetes API ${path} failed with ${response.statusCode}: ${body}`))
          return
        }

        resolve(safeJsonParse(body, {}))
      })
    })

    request.on('error', reject)
    request.end()
  })
}

const readClusterStateFromKubeApi = async () => {
  const [pods, deployments, hpa, podMetrics] = await Promise.all([
    fetchKubeJson(`/api/v1/namespaces/${kubeNamespace}/pods`),
    fetchKubeJson(`/apis/apps/v1/namespaces/${kubeNamespace}/deployments`),
    fetchKubeJson(`/apis/autoscaling/v2/namespaces/${kubeNamespace}/horizontalpodautoscalers/backend-hpa`),
    fetchKubeJson(`/apis/metrics.k8s.io/v1beta1/namespaces/${kubeNamespace}/pods`),
  ])

  return { pods, deployments, hpa, podMetrics }
}

const readClusterStateFromKubectl = async () => {
  const [podsRaw, deploymentsRaw, hpaRaw, topRaw] = await Promise.all([
    execFileAsync('kubectl', ['get', 'pods', '-n', kubeNamespace, '-o', 'json']),
    execFileAsync('kubectl', ['get', 'deployments', '-n', kubeNamespace, '-o', 'json']),
    execFileAsync('kubectl', ['get', 'hpa', 'backend-hpa', '-n', kubeNamespace, '-o', 'json']),
    execFileAsync('kubectl', ['top', 'pods', '-n', kubeNamespace, '--no-headers']),
  ])

  const metricLines = topRaw.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const metricItems = metricLines.map((line) => {
    const [name, cpu, memory] = line.split(/\s+/)
    return {
      metadata: { name },
      containers: [{ usage: { cpu, memory } }],
    }
  })

  return {
    pods: safeJsonParse(podsRaw.stdout, { items: [] }),
    deployments: safeJsonParse(deploymentsRaw.stdout, { items: [] }),
    hpa: safeJsonParse(hpaRaw.stdout, {}),
    podMetrics: { items: metricItems },
  }
}

const aggregatePodUsage = (metricItem) => {
  const usage = (metricItem.containers || []).reduce((totals, container) => {
    totals.cpuMillicores += parseCpuToMillicores(container.usage?.cpu)
    totals.memoryMiB += parseMemoryToMiB(container.usage?.memory)
    return totals
  }, { cpuMillicores: 0, memoryMiB: 0 })

  return {
    cpuMillicores: Number(usage.cpuMillicores.toFixed(2)),
    memoryMiB: Number(usage.memoryMiB.toFixed(2)),
  }
}

const buildClusterSnapshot = ({ pods, deployments, hpa, podMetrics }) => {
  const relevantDeployments = ['backend', 'frontend', 'redis']
  const deploymentMap = new Map((deployments.items || []).map((deployment) => [deployment.metadata?.name, deployment]))
  const podMetricsMap = new Map((podMetrics.items || []).map((item) => [item.metadata?.name, aggregatePodUsage(item)]))

  const podRows = (pods.items || [])
    .filter((pod) => relevantDeployments.includes(pod.metadata?.labels?.app))
    .map((pod) => {
      const podName = pod.metadata?.name || 'unknown'
      const usage = podMetricsMap.get(podName) || { cpuMillicores: 0, memoryMiB: 0 }
      return {
        name: podName,
        app: pod.metadata?.labels?.app || 'unknown',
        phase: pod.status?.phase || 'Unknown',
        ready: (pod.status?.containerStatuses || []).every((status) => status.ready),
        restarts: (pod.status?.containerStatuses || []).reduce((sum, status) => sum + (status.restartCount || 0), 0),
        ip: pod.status?.podIP || '-',
        node: pod.spec?.nodeName || '-',
        cpuMillicores: usage.cpuMillicores,
        memoryMiB: usage.memoryMiB,
      }
    })
    .sort((left, right) => left.app.localeCompare(right.app) || left.name.localeCompare(right.name))

  const replicas = relevantDeployments.map((name) => {
    const deployment = deploymentMap.get(name)
    return {
      name,
      desired: deployment?.spec?.replicas || 0,
      current: deployment?.status?.replicas || 0,
      ready: deployment?.status?.readyReplicas || 0,
      available: deployment?.status?.availableReplicas || 0,
      updated: deployment?.status?.updatedReplicas || 0,
    }
  })

  const currentCpuMetric = hpa?.status?.currentMetrics?.find((metric) => metric.type === 'Resource' && metric.resource?.name === 'cpu')

  return {
    namespace: kubeNamespace,
    source: kubeHost ? 'kubernetes-api' : 'kubectl',
    replicas,
    hpa: {
      name: hpa?.metadata?.name || 'backend-hpa',
      minReplicas: hpa?.spec?.minReplicas || 0,
      maxReplicas: hpa?.spec?.maxReplicas || 0,
      currentReplicas: hpa?.status?.currentReplicas || 0,
      desiredReplicas: hpa?.status?.desiredReplicas || 0,
      currentCpuUtilization: currentCpuMetric?.resource?.current?.averageUtilization ?? null,
      currentCpuValue: currentCpuMetric?.resource?.current?.averageValue || null,
      targetCpuUtilization: hpa?.spec?.metrics?.find((metric) => metric.type === 'Resource' && metric.resource?.name === 'cpu')?.resource?.target?.averageUtilization ?? null,
      lastScaleTime: hpa?.status?.lastScaleTime || null,
      conditions: (hpa?.status?.conditions || []).map((condition) => ({
        type: condition.type,
        status: condition.status,
        reason: condition.reason,
        message: condition.message,
      })),
    },
    pods: podRows,
    generatedAt: new Date().toISOString(),
  }
}

const getClusterSnapshot = async () => {
  const clusterState = kubeHost
    ? await readClusterStateFromKubeApi()
    : await readClusterStateFromKubectl()

  return buildClusterSnapshot(clusterState)
}

const recordRequestMetrics = (path, statusCode, latencyMs) => {
  requestMetrics.totalRequests += 1
  requestMetrics.totalLatencyMs += latencyMs
  if (statusCode >= 400) {
    requestMetrics.totalErrors += 1
  }

  if (!requestMetrics.routes[path]) {
    requestMetrics.routes[path] = {
      count: 0,
      errors: 0,
      totalLatencyMs: 0,
    }
  }

  requestMetrics.routes[path].count += 1
  requestMetrics.routes[path].totalLatencyMs += latencyMs
  if (statusCode >= 400) {
    requestMetrics.routes[path].errors += 1
  }
}

const serializeRouteMetrics = () => {
  const serialized = {}
  for (const [path, routeStats] of Object.entries(requestMetrics.routes)) {
    serialized[path] = {
      count: routeStats.count,
      errors: routeStats.errors,
      avgLatencyMs: routeStats.count > 0
        ? Number((routeStats.totalLatencyMs / routeStats.count).toFixed(2))
        : 0,
    }
  }
  return serialized
}

app.use(async (req, res, next) => {
  const requestStart = process.hrtime.bigint()
  const injectOnThisRoute = req.path === '/' || req.path === '/info'

  res.on('finish', () => {
    const elapsedNs = process.hrtime.bigint() - requestStart
    const latencyMs = Number(elapsedNs) / 1_000_000
    recordRequestMetrics(req.path, res.statusCode, latencyMs)
  })

  if (injectOnThisRoute && labConfig.artificialDelayMs > 0) {
    await sleep(labConfig.artificialDelayMs)
  }

  if (injectOnThisRoute && labConfig.failureRate > 0 && Math.random() < labConfig.failureRate) {
    const podName = process.env.POD_NAME || 'local-dev'
    res.status(503).json({
      error: 'Injected failure for Kubernetes lab',
      pod: podName,
      time: new Date().toISOString(),
      config: {
        failureRate: labConfig.failureRate,
        artificialDelayMs: labConfig.artificialDelayMs,
      },
    })
    return
  }

  next()
})

const initRedis = async () => {
  try {
    redis = createClient({
      socket: {
        host: redisHost,
        port: redisPort,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('Max Redis reconnection attempts reached')
            return new Error('Max retries reached')
          }
          return retries * 100
        }
      }
    })

    redis.on('error', (err) => {
      console.error('Redis Client Error:', err.message)
      redisConnected = false
    })

    redis.on('connect', () => {
      console.log('Connected to Redis')
      redisConnected = true
    })

    await redis.connect()
  } catch (err) {
    console.error('Failed to initialize Redis:', err.message)
    redisConnected = false
  }
}

const getContainerIP = () => {
  const interfaces = networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return 'localhost'
}

app.get('/', async (req, res) => {
  try {
    let visits = 0
    if (redisConnected && redis) {
      visits = await redis.incr('visits')
    }
    const podName = process.env.POD_NAME || 'local-dev'
    res.json({
      message: 'Hello from Kubernetes',
      hostname: podName,
      pod: podName,
      visits: visits,
      time: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Error in GET /:', err)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

app.get('/info', async (req, res) => {
  try {
    let visits = 0
    if (redisConnected && redis) {
      const visitsStr = await redis.get('visits')
      visits = visitsStr ? parseInt(visitsStr) : 0
    }
    // In Kubernetes, read pod name from downward API environment variable
    const podName = process.env.POD_NAME || 'local-dev'
    res.json({
      hostname: podName,
      pod: podName,
      ip: getContainerIP(),
      visits: visits,
      redisConnected,
      version: version,
      time: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Error in GET /info:', err)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' })
})

app.get('/lab/config', (req, res) => {
  res.json({
    failureRate: labConfig.failureRate,
    artificialDelayMs: labConfig.artificialDelayMs,
  })
})

app.post('/lab/config', (req, res) => {
  const failureRateInput = req.body?.failureRate
  const artificialDelayInput = req.body?.artificialDelayMs

  let nextFailureRate = labConfig.failureRate
  let nextDelayMs = labConfig.artificialDelayMs

  if (failureRateInput !== undefined) {
    let parsedFailureRate = Number(failureRateInput)
    if (Number.isNaN(parsedFailureRate)) {
      return res.status(400).json({ error: 'failureRate must be a number' })
    }
    if (parsedFailureRate > 1) {
      parsedFailureRate = parsedFailureRate / 100
    }
    nextFailureRate = clamp(parsedFailureRate, 0, 1)
  }

  if (artificialDelayInput !== undefined) {
    const parsedDelay = Number(artificialDelayInput)
    if (Number.isNaN(parsedDelay)) {
      return res.status(400).json({ error: 'artificialDelayMs must be a number' })
    }
    nextDelayMs = Math.trunc(clamp(parsedDelay, 0, 5000))
  }

  labConfig.failureRate = nextFailureRate
  labConfig.artificialDelayMs = nextDelayMs

  res.json({
    message: 'Lab config updated',
    failureRate: labConfig.failureRate,
    artificialDelayMs: labConfig.artificialDelayMs,
  })
})

app.get('/lab/metrics', (req, res) => {
  const avgLatencyMs = requestMetrics.totalRequests > 0
    ? requestMetrics.totalLatencyMs / requestMetrics.totalRequests
    : 0
  const podName = process.env.POD_NAME || 'local-dev'

  res.json({
    pod: podName,
    ip: getContainerIP(),
    version,
    redisConnected,
    config: {
      failureRate: labConfig.failureRate,
      artificialDelayMs: labConfig.artificialDelayMs,
    },
    totals: {
      startedAt: new Date(requestMetrics.startedAt).toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      totalRequests: requestMetrics.totalRequests,
      totalErrors: requestMetrics.totalErrors,
      errorRatePercent: requestMetrics.totalRequests > 0
        ? Number(((requestMetrics.totalErrors / requestMetrics.totalRequests) * 100).toFixed(2))
        : 0,
      avgLatencyMs: Number(avgLatencyMs.toFixed(2)),
    },
    routes: serializeRouteMetrics(),
    time: new Date().toISOString(),
  })
})

app.get('/lab/cluster', async (req, res) => {
  try {
    const snapshot = await getClusterSnapshot()
    res.json(snapshot)
  } catch (err) {
    console.error('Error in GET /lab/cluster:', err)
    res.status(500).json({
      error: 'Failed to fetch cluster state',
      details: err.message,
    })
  }
})

app.post('/lab/reset', async (req, res) => {
  const resetVisits = Boolean(req.body?.resetVisits)

  requestMetrics = {
    startedAt: Date.now(),
    totalRequests: 0,
    totalErrors: 0,
    totalLatencyMs: 0,
    routes: {},
  }

  if (resetVisits && redisConnected && redis) {
    try {
      await redis.del('visits')
    } catch (err) {
      console.error('Failed to reset Redis visits:', err.message)
    }
  }

  res.json({
    message: 'Lab metrics reset',
    resetVisits,
    time: new Date().toISOString(),
  })
})

initRedis()

app.listen(port, () => {
  console.log(`Backend server running on port ${port}`)
  console.log(`Redis connection: ${redisHost}:${redisPort}`)
  console.log(`Redis connected: ${redisConnected}`)
})
