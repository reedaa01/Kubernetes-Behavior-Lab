import express from 'express'
import cors from 'cors'
import { createClient } from 'redis'
import os from 'os'
import { networkInterfaces } from 'os'

const app = express()
const port = process.env.PORT || 3001
const redisHost = process.env.REDIS_HOST || 'localhost'
const redisPort = parseInt(process.env.REDIS_PORT) || 6379
const version = '1.0.0'

app.use(cors())
app.use(express.json())

let redis = null
let redisConnected = false

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
    res.json({
      message: 'Hello from Kubernetes',
      hostname: os.hostname(),
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
    res.json({
      hostname: os.hostname(),
      pod: os.hostname(),
      ip: getContainerIP(),
      visits: visits,
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

initRedis()

app.listen(port, () => {
  console.log(`Backend server running on port ${port}`)
  console.log(`Redis connection: ${redisHost}:${redisPort}`)
  console.log(`Redis connected: ${redisConnected}`)
})
