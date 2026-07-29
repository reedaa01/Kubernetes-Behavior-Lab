import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../server.js'

describe('GET /health', () => {
  it('returns 200 with healthy status', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'healthy' })
  })
})

describe('GET /', () => {
  it('returns 200 with expected fields', async () => {
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      message: expect.any(String),
      pod: expect.any(String),
      hostname: expect.any(String),
      visits: expect.any(Number),
      time: expect.any(String),
    })
  })
})

describe('GET /info', () => {
  it('returns 200 with pod and version fields', async () => {
    const res = await request(app).get('/info')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      pod: expect.any(String),
      hostname: expect.any(String),
      ip: expect.any(String),
      version: expect.any(String),
      redisConnected: expect.any(Boolean),
      time: expect.any(String),
    })
  })
})

describe('GET /lab/config', () => {
  it('returns current lab config', async () => {
    const res = await request(app).get('/lab/config')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      failureRate: expect.any(Number),
      artificialDelayMs: expect.any(Number),
    })
  })
})

describe('POST /lab/config', () => {
  beforeEach(async () => {
    // reset config before each test
    await request(app).post('/lab/config').send({ failureRate: 0, artificialDelayMs: 0 })
  })

  it('updates failure rate as a fraction (0–1)', async () => {
    const res = await request(app).post('/lab/config').send({ failureRate: 0.5 })
    expect(res.status).toBe(200)
    expect(res.body.failureRate).toBeCloseTo(0.5)
  })

  it('normalises failure rate > 1 by dividing by 100', async () => {
    const res = await request(app).post('/lab/config').send({ failureRate: 50 })
    expect(res.status).toBe(200)
    expect(res.body.failureRate).toBeCloseTo(0.5)
  })

  it('clamps failure rate to [0, 1]', async () => {
    const res = await request(app).post('/lab/config').send({ failureRate: 200 })
    expect(res.status).toBe(200)
    expect(res.body.failureRate).toBe(1)
  })

  it('updates artificialDelayMs', async () => {
    const res = await request(app).post('/lab/config').send({ artificialDelayMs: 100 })
    expect(res.status).toBe(200)
    expect(res.body.artificialDelayMs).toBe(100)
  })

  it('clamps artificialDelayMs to [0, 5000]', async () => {
    const res = await request(app).post('/lab/config').send({ artificialDelayMs: 9999 })
    expect(res.status).toBe(200)
    expect(res.body.artificialDelayMs).toBe(5000)
  })

  it('returns 400 for non-numeric failureRate', async () => {
    const res = await request(app).post('/lab/config').send({ failureRate: 'bad' })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })

  it('returns 400 for non-numeric artificialDelayMs', async () => {
    const res = await request(app).post('/lab/config').send({ artificialDelayMs: 'bad' })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })
})

describe('GET /lab/metrics', () => {
  it('returns metrics shape', async () => {
    const res = await request(app).get('/lab/metrics')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      pod: expect.any(String),
      version: expect.any(String),
      redisConnected: expect.any(Boolean),
      totals: expect.objectContaining({
        totalRequests: expect.any(Number),
        totalErrors: expect.any(Number),
        errorRatePercent: expect.any(Number),
        avgLatencyMs: expect.any(Number),
        uptimeSeconds: expect.any(Number),
      }),
    })
  })

  it('tracks requests made through /health', async () => {
    await request(app).get('/health')
    const res = await request(app).get('/lab/metrics')
    expect(res.body.totals.totalRequests).toBeGreaterThan(0)
  })
})

describe('POST /lab/reset', () => {
  it('resets metrics and returns confirmation', async () => {
    await request(app).get('/')
    const res = await request(app).post('/lab/reset').send({ resetVisits: false })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      message: 'Lab metrics reset',
      resetVisits: false,
      time: expect.any(String),
    })
  })

  it('metrics are zeroed after reset', async () => {
    await request(app).get('/')
    await request(app).post('/lab/reset').send({})
    const metrics = await request(app).get('/lab/metrics')
    // Only the /lab/metrics call itself should have been counted
    expect(metrics.body.totals.totalRequests).toBe(1)
  })
})

describe('Failure injection middleware', () => {
  it('does not inject failures when failureRate is 0', async () => {
    await request(app).post('/lab/config').send({ failureRate: 0 })
    const results = await Promise.all(
      Array.from({ length: 10 }, () => request(app).get('/'))
    )
    expect(results.every((r) => r.status === 200)).toBe(true)
  })

  it('injects 503 when failureRate is 1', async () => {
    await request(app).post('/lab/config').send({ failureRate: 1 })
    const res = await request(app).get('/')
    expect(res.status).toBe(503)
    expect(res.body).toHaveProperty('error')
    // cleanup
    await request(app).post('/lab/config').send({ failureRate: 0 })
  })
})
