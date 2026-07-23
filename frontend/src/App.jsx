import { useState, useEffect, useMemo, useRef } from 'react'
import axios from 'axios'
import './App.css'

function App() {
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [latestInfo, setLatestInfo] = useState(null)
  const [backendConfig, setBackendConfig] = useState({ failureRate: 0, artificialDelayMs: 0 })
  const [backendMetrics, setBackendMetrics] = useState(null)
  const [clusterState, setClusterState] = useState(null)
  const [history, setHistory] = useState([])
  const [podStats, setPodStats] = useState({})

  const [trafficConfig, setTrafficConfig] = useState({
    rps: 4,
    durationSec: 20,
  })

  const [faultConfig, setFaultConfig] = useState({
    failureRatePercent: 0,
    artificialDelayMs: 0,
  })

  const [trafficState, setTrafficState] = useState({
    running: false,
    sent: 0,
    success: 0,
    failed: 0,
    startedAt: null,
    endedAt: null,
  })

  const trafficTimerRef = useRef(null)
  const stopTrafficRef = useRef(false)

  const backendUrl = import.meta.env.VITE_BACKEND_URL || (
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:3001'
      : ''
  )

  const addTimelinePoint = (type, payload = {}) => {
    const point = {
      time: Date.now(),
      type,
      ...payload,
    }

    setHistory((prev) => {
      const next = [...prev, point]
      return next.slice(-60)
    })
  }

  const trackPodSample = (pod, ok, latencyMs) => {
    if (!pod) {
      return
    }

    setPodStats((prev) => {
      const current = prev[pod] || {
        total: 0,
        ok: 0,
        failed: 0,
        totalLatencyMs: 0,
        lastSeen: null,
      }

      return {
        ...prev,
        [pod]: {
          ...current,
          total: current.total + 1,
          ok: current.ok + (ok ? 1 : 0),
          failed: current.failed + (ok ? 0 : 1),
          totalLatencyMs: current.totalLatencyMs + latencyMs,
          lastSeen: new Date().toISOString(),
        },
      }
    })
  }

  const fetchInfo = async () => {
    try {
      const response = await axios.get(`${backendUrl}/info`)
      const info = response?.data
      if (!info || typeof info !== 'object' || !('pod' in info) || !('ip' in info)) {
        throw new Error('Invalid /info response. Check frontend-to-backend routing.')
      }
      setLatestInfo(response.data)
      setStatus('healthy')
      setError('')
      return response.data
    } catch (err) {
      setStatus('unhealthy')
      setError(err.message)
      return null
    }
  }

  const fetchLabData = async () => {
    try {
      const [configRes, metricsRes, clusterRes] = await Promise.all([
        axios.get(`${backendUrl}/lab/config`),
        axios.get(`${backendUrl}/lab/metrics`),
        axios.get(`${backendUrl}/lab/cluster`),
      ])
      setBackendConfig(configRes.data)
      setBackendMetrics(metricsRes.data)
      setClusterState(clusterRes.data)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    const load = async () => {
      await fetchInfo()
      await fetchLabData()
    }

    load()
    const interval = setInterval(load, 2000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    setFaultConfig({
      failureRatePercent: Math.round((backendConfig.failureRate || 0) * 100),
      artificialDelayMs: backendConfig.artificialDelayMs || 0,
    })
  }, [backendConfig.failureRate, backendConfig.artificialDelayMs])

  useEffect(() => {
    return () => {
      if (trafficTimerRef.current) {
        clearInterval(trafficTimerRef.current)
      }
      stopTrafficRef.current = true
    }
  }, [])

  const applyFaultConfig = async () => {
    try {
      await axios.post(`${backendUrl}/lab/config`, {
        failureRate: faultConfig.failureRatePercent,
        artificialDelayMs: faultConfig.artificialDelayMs,
      })
      addTimelinePoint('config', {
        label: `Set failure ${faultConfig.failureRatePercent}% / delay ${faultConfig.artificialDelayMs}ms`,
      })
      await fetchLabData()
    } catch (err) {
      setError(err.message)
    }
  }

  const resetLab = async () => {
    try {
      await axios.post(`${backendUrl}/lab/reset`, { resetVisits: false })
      setPodStats({})
      setHistory([])
      setTrafficState({
        running: false,
        sent: 0,
        success: 0,
        failed: 0,
        startedAt: null,
        endedAt: null,
      })
      addTimelinePoint('reset', { label: 'Lab metrics reset' })
      await fetchInfo()
      await fetchLabData()
    } catch (err) {
      setError(err.message)
    }
  }

  const stopTraffic = () => {
    stopTrafficRef.current = true
    if (trafficTimerRef.current) {
      clearInterval(trafficTimerRef.current)
    }
    setTrafficState((prev) => ({ ...prev, running: false, endedAt: Date.now() }))
    addTimelinePoint('traffic-stop', { label: 'Traffic stopped' })
  }

  const startTraffic = () => {
    if (trafficState.running) {
      return
    }

    const rps = Math.max(1, Number(trafficConfig.rps) || 1)
    const durationSec = Math.max(1, Number(trafficConfig.durationSec) || 1)

    stopTrafficRef.current = false
    const startedAt = Date.now()
    const endAt = startedAt + durationSec * 1000

    setTrafficState({
      running: true,
      sent: 0,
      success: 0,
      failed: 0,
      startedAt,
      endedAt: null,
    })
    addTimelinePoint('traffic-start', { label: `Start ${rps} rps for ${durationSec}s` })

    const tickMs = Math.max(100, Math.floor(1000 / rps))

    trafficTimerRef.current = setInterval(async () => {
      if (stopTrafficRef.current || Date.now() >= endAt) {
        stopTraffic()
        return
      }

      const started = performance.now()
      try {
        const response = await axios.get(`${backendUrl}/`)
        const latency = performance.now() - started
        const pod = response.data?.pod || response.data?.hostname || latestInfo?.pod || 'unknown'

        setTrafficState((prev) => ({
          ...prev,
          sent: prev.sent + 1,
          success: prev.success + 1,
        }))
        trackPodSample(pod, true, latency)
        addTimelinePoint('request', { pod, ok: true, latencyMs: Number(latency.toFixed(1)) })
      } catch (err) {
        const latency = performance.now() - started
        const pod = err?.response?.data?.pod || 'unknown'

        setTrafficState((prev) => ({
          ...prev,
          sent: prev.sent + 1,
          failed: prev.failed + 1,
        }))
        trackPodSample(pod, false, latency)
        addTimelinePoint('request', { pod, ok: false, latencyMs: Number(latency.toFixed(1)) })
      }
    }, tickMs)
  }

  const podRows = useMemo(() => {
    return Object.entries(podStats)
      .map(([pod, stats]) => {
        const avgLatency = stats.total > 0 ? stats.totalLatencyMs / stats.total : 0
        return {
          pod,
          total: stats.total,
          ok: stats.ok,
          failed: stats.failed,
          successRate: stats.total > 0 ? Math.round((stats.ok / stats.total) * 100) : 0,
          avgLatency: Number(avgLatency.toFixed(1)),
          lastSeen: stats.lastSeen,
        }
      })
      .sort((a, b) => b.total - a.total)
  }, [podStats])

  const sparklinePoints = useMemo(() => {
    const reqPoints = history.filter((h) => h.type === 'request').slice(-24)
    return reqPoints.map((point) => point.latencyMs)
  }, [history])

  const sparklinePath = useMemo(() => {
    if (sparklinePoints.length < 2) {
      return ''
    }

    const width = 220
    const height = 56
    const maxVal = Math.max(...sparklinePoints, 1)

    return sparklinePoints
      .map((value, index) => {
        const x = (index / (sparklinePoints.length - 1)) * width
        const y = height - (value / maxVal) * height
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
      })
      .join(' ')
  }, [sparklinePoints])

  const errorRate = trafficState.sent > 0
    ? ((trafficState.failed / trafficState.sent) * 100).toFixed(1)
    : '0.0'

  const trafficDurationSeconds = trafficState.startedAt
    ? Math.round(((trafficState.endedAt || Date.now()) - trafficState.startedAt) / 1000)
    : 0

  const clusterPods = clusterState?.pods || []
  const replicaRows = clusterState?.replicas || []
  const hpaState = clusterState?.hpa || null

  return (
    <div className="page">
      <header className="hero">
        <h1>Kubernetes Behavior Lab</h1>
        <p>Generate traffic, inject delay and errors, and observe live pod behavior.</p>
      </header>

      <section className="panel grid-3">
        <div className="tile">
          <h3>Backend Status</h3>
          <div className={`status ${status}`}>
            {status === 'healthy' ? 'Healthy' : status === 'unhealthy' ? 'Unhealthy' : 'Loading'}
          </div>
          <p className="muted">Pod: {latestInfo?.pod || '-'}</p>
          <p className="muted">IP: {latestInfo?.ip || '-'}</p>
          <p className="muted">Redis: {latestInfo?.redisConnected ? 'Connected' : 'Disconnected'}</p>
        </div>

        <div className="tile">
          <h3>Live Metrics</h3>
          <div className="metric-row"><span>Total Requests</span><strong>{backendMetrics?.totals?.totalRequests ?? 0}</strong></div>
          <div className="metric-row"><span>Total Errors</span><strong>{backendMetrics?.totals?.totalErrors ?? 0}</strong></div>
          <div className="metric-row"><span>Error Rate</span><strong>{backendMetrics?.totals?.errorRatePercent ?? 0}%</strong></div>
          <div className="metric-row"><span>Avg Latency</span><strong>{backendMetrics?.totals?.avgLatencyMs ?? 0} ms</strong></div>
          <div className="metric-row"><span>Uptime</span><strong>{backendMetrics?.totals?.uptimeSeconds ?? 0} s</strong></div>
        </div>

        <div className="tile">
          <h3>Traffic Run</h3>
          <div className="metric-row"><span>Running</span><strong>{trafficState.running ? 'Yes' : 'No'}</strong></div>
          <div className="metric-row"><span>Sent</span><strong>{trafficState.sent}</strong></div>
          <div className="metric-row"><span>Success</span><strong>{trafficState.success}</strong></div>
          <div className="metric-row"><span>Failed</span><strong>{trafficState.failed}</strong></div>
          <div className="metric-row"><span>Error %</span><strong>{errorRate}%</strong></div>
          <div className="metric-row"><span>Duration</span><strong>{trafficDurationSeconds}s</strong></div>
        </div>
      </section>

      <section className="panel grid-3">
        <div className="tile">
          <h3>HPA Status</h3>
          <div className="metric-row"><span>Current Replicas</span><strong>{hpaState?.currentReplicas ?? '-'}</strong></div>
          <div className="metric-row"><span>Desired Replicas</span><strong>{hpaState?.desiredReplicas ?? '-'}</strong></div>
          <div className="metric-row"><span>Min / Max</span><strong>{hpaState ? `${hpaState.minReplicas} / ${hpaState.maxReplicas}` : '-'}</strong></div>
          <div className="metric-row"><span>CPU Current</span><strong>{hpaState?.currentCpuUtilization ?? '-'}%</strong></div>
          <div className="metric-row"><span>CPU Target</span><strong>{hpaState?.targetCpuUtilization ?? '-'}%</strong></div>
          <div className="metric-row"><span>Avg CPU Value</span><strong>{hpaState?.currentCpuValue || '-'}</strong></div>
        </div>

        <div className="tile">
          <h3>Replica Overview</h3>
          {replicaRows.length === 0 && <p className="muted">Cluster data not available yet.</p>}
          {replicaRows.map((row) => (
            <div className="metric-row" key={row.name}>
              <span>{row.name}</span>
              <strong>{row.ready}/{row.desired} ready</strong>
            </div>
          ))}
        </div>

        <div className="tile">
          <h3>Cluster Feed</h3>
          <div className="metric-row"><span>Namespace</span><strong>{clusterState?.namespace || '-'}</strong></div>
          <div className="metric-row"><span>Data Source</span><strong>{clusterState?.source || '-'}</strong></div>
          <div className="metric-row"><span>Pods Seen</span><strong>{clusterPods.length}</strong></div>
          <div className="metric-row"><span>Last Refresh</span><strong>{clusterState?.generatedAt ? new Date(clusterState.generatedAt).toLocaleTimeString() : '-'}</strong></div>
          <p className="muted small">The HPA section updates as Kubernetes changes desired and current replicas.</p>
        </div>
      </section>

      <section className="panel controls">
        <div className="tile">
          <h3>Traffic Generator</h3>
          <div className="control-grid">
            <label>
              Requests per second
              <input
                type="number"
                min="1"
                max="50"
                value={trafficConfig.rps}
                onChange={(e) => setTrafficConfig((prev) => ({ ...prev, rps: Number(e.target.value) }))}
              />
            </label>
            <label>
              Duration (seconds)
              <input
                type="number"
                min="1"
                max="300"
                value={trafficConfig.durationSec}
                onChange={(e) => setTrafficConfig((prev) => ({ ...prev, durationSec: Number(e.target.value) }))}
              />
            </label>
          </div>
          <div className="actions">
            <button onClick={startTraffic} disabled={trafficState.running}>Start Test</button>
            <button onClick={stopTraffic} disabled={!trafficState.running} className="ghost">Stop</button>
            <button onClick={resetLab} className="danger">Reset</button>
          </div>
        </div>

        <div className="tile">
          <h3>Failure Injection</h3>
          <div className="control-grid">
            <label>
              Failure rate (%)
              <input
                type="number"
                min="0"
                max="100"
                value={faultConfig.failureRatePercent}
                onChange={(e) => setFaultConfig((prev) => ({ ...prev, failureRatePercent: Number(e.target.value) }))}
              />
            </label>
            <label>
              Artificial delay (ms)
              <input
                type="number"
                min="0"
                max="5000"
                value={faultConfig.artificialDelayMs}
                onChange={(e) => setFaultConfig((prev) => ({ ...prev, artificialDelayMs: Number(e.target.value) }))}
              />
            </label>
          </div>
          <div className="actions">
            <button onClick={applyFaultConfig}>Apply Lab Config</button>
          </div>
          <p className="muted small">
            Current backend config: {Math.round((backendConfig.failureRate || 0) * 100)}% failure, {backendConfig.artificialDelayMs || 0}ms delay
          </p>
        </div>
      </section>

      <section className="panel grid-2">
        <div className="tile">
          <h3>Latency Trend (last 24 requests)</h3>
          <svg className="sparkline" viewBox="0 0 220 56" preserveAspectRatio="none">
            <path d={sparklinePath} fill="none" stroke="#007a63" strokeWidth="2" />
          </svg>
          <p className="muted">Points: {sparklinePoints.length}</p>
        </div>

        <div className="tile timeline">
          <h3>Event Timeline</h3>
          <div className="events">
            {history.length === 0 && <p className="muted">No events yet</p>}
            {history.slice().reverse().map((event, idx) => (
              <div className="event" key={`${event.time}-${idx}`}>
                <span>{new Date(event.time).toLocaleTimeString()}</span>
                <strong>{event.label || event.type}</strong>
                {'latencyMs' in event ? <em>{event.latencyMs}ms</em> : <em> </em>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="tile">
          <h3>Per-Pod Distribution</h3>
          <div className="pod-table-wrap">
            <table className="pod-table">
              <thead>
                <tr>
                  <th>Pod</th>
                  <th>Total</th>
                  <th>OK</th>
                  <th>Failed</th>
                  <th>Success %</th>
                  <th>Avg Latency</th>
                  <th>Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {podRows.length === 0 && (
                  <tr>
                    <td colSpan="7" className="empty">Run a traffic test to see pod distribution.</td>
                  </tr>
                )}
                {podRows.map((row) => (
                  <tr key={row.pod}>
                    <td>{row.pod}</td>
                    <td>{row.total}</td>
                    <td>{row.ok}</td>
                    <td>{row.failed}</td>
                    <td>{row.successRate}%</td>
                    <td>{row.avgLatency} ms</td>
                    <td>{row.lastSeen ? new Date(row.lastSeen).toLocaleTimeString() : '�'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="tile">
          <h3>Live Pod Usage</h3>
          <div className="pod-table-wrap">
            <table className="pod-table">
              <thead>
                <tr>
                  <th>Pod</th>
                  <th>App</th>
                  <th>Phase</th>
                  <th>Ready</th>
                  <th>Restarts</th>
                  <th>CPU</th>
                  <th>Memory</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {clusterPods.length === 0 && (
                  <tr>
                    <td colSpan="8" className="empty">No cluster pod data yet.</td>
                  </tr>
                )}
                {clusterPods.map((pod) => (
                  <tr key={pod.name}>
                    <td>{pod.name}</td>
                    <td>{pod.app}</td>
                    <td>{pod.phase}</td>
                    <td>{pod.ready ? 'Yes' : 'No'}</td>
                    <td>{pod.restarts}</td>
                    <td>{pod.cpuMillicores} m</td>
                    <td>{pod.memoryMiB} Mi</td>
                    <td>{pod.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {error && <p className="global-error">{error}</p>}
    </div>
  )
}

export default App
