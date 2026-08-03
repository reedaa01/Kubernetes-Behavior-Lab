import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import App from '../App.jsx'

const mock = new MockAdapter(axios)

const infoPayload = {
  pod: 'backend-pod-abc',
  hostname: 'backend-pod-abc',
  ip: '10.0.0.1',
  visits: 5,
  redisConnected: true,
  version: '1.0.0',
  time: new Date().toISOString(),
}

const configPayload = { failureRate: 0, artificialDelayMs: 0 }

const metricsPayload = {
  pod: 'backend-pod-abc',
  version: '1.0.0',
  redisConnected: true,
  totals: {
    totalRequests: 42,
    totalErrors: 2,
    errorRatePercent: 4.76,
    avgLatencyMs: 12.5,
    uptimeSeconds: 300,
  },
  routes: {},
  time: new Date().toISOString(),
}

const clusterPayload = {
  namespace: 'default',
  source: 'kubectl',
  pods: [],
  replicas: [],
  hpa: null,
  generatedAt: new Date().toISOString(),
}

function setupMocks() {
  mock.onGet(/\/info/).reply(200, infoPayload)
  mock.onGet(/\/lab\/config/).reply(200, configPayload)
  mock.onGet(/\/lab\/metrics/).reply(200, metricsPayload)
  mock.onGet(/\/lab\/cluster/).reply(200, clusterPayload)
  mock.onPost(/\/lab\/config/).reply(200, { message: 'ok', failureRate: 0, artificialDelayMs: 0 })
  mock.onPost(/\/lab\/reset/).reply(200, { message: 'Lab metrics reset', resetVisits: false, time: new Date().toISOString() })
  mock.onGet(/\/$/).reply(200, { pod: 'backend-pod-abc', visits: 1, time: new Date().toISOString() })
}

// Helper: render and wait for the initial data fetch to settle
async function renderAndWait() {
  let result
  await act(async () => {
    result = render(<App />)
  })
  await waitFor(() => expect(screen.getByText('Healthy')).toBeInTheDocument())
  return result
}

beforeEach(() => {
  setupMocks()
})

afterEach(() => {
  mock.reset()
  vi.restoreAllMocks()
})

describe('App — initial render', () => {
  it('renders the page heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /Kubernetes Behavior Lab/i })).toBeInTheDocument()
  })

  it('shows Loading status before first fetch completes', () => {
    // delay /info so it hasn't resolved at render time
    mock.onGet(/\/info/).reply(() => new Promise(() => {}))
    render(<App />)
    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('shows Healthy status after successful /info fetch', async () => {
    await renderAndWait()
    expect(screen.getByText('Healthy')).toBeInTheDocument()
  })

  it('shows pod name returned from /info', async () => {
    await renderAndWait()
    expect(screen.getByText(/backend-pod-abc/)).toBeInTheDocument()
  })

  it('shows redis as Connected when redisConnected=true', async () => {
    await renderAndWait()
    expect(screen.getByText(/Connected/)).toBeInTheDocument()
  })
})

describe('App — unhealthy state', () => {
  it('shows Unhealthy when /info returns a network error', async () => {
    mock.onGet(/\/info/).networkError()
    await act(async () => { render(<App />) })
    await waitFor(() => expect(screen.getByText('Unhealthy')).toBeInTheDocument())
  })

  it('shows Unhealthy when /info returns invalid shape', async () => {
    mock.onGet(/\/info/).reply(200, { unexpected: true })
    await act(async () => { render(<App />) })
    await waitFor(() => expect(screen.getByText('Unhealthy')).toBeInTheDocument())
  })
})

describe('App — live metrics panel', () => {
  it('renders total requests from /lab/metrics', async () => {
    await renderAndWait()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders error count from /lab/metrics', async () => {
    await renderAndWait()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})

describe('App — traffic generator controls', () => {
  it('renders Start Test button', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeInTheDocument()
  })

  it('Stop button is disabled before traffic starts', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
  })

  it('Start Test button is enabled before traffic starts', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Start Test' })).not.toBeDisabled()
  })

  it('updates rps input value', async () => {
    render(<App />)
    const rpsInput = screen.getAllByRole('spinbutton')[0]
    await userEvent.clear(rpsInput)
    await userEvent.type(rpsInput, '10')
    expect(rpsInput.value).toBe('10')
  })

  it('updates duration input value', async () => {
    render(<App />)
    const durationInput = screen.getAllByRole('spinbutton')[1]
    await userEvent.clear(durationInput)
    await userEvent.type(durationInput, '30')
    expect(durationInput.value).toBe('30')
  })

  it('enables Stop and disables Start after clicking Start Test', async () => {
    await renderAndWait()
    fireEvent.click(screen.getByRole('button', { name: 'Start Test' }))
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stop' })).not.toBeDisabled()
  })
})

describe('App — failure injection controls', () => {
  it('renders failure rate input with initial value 0', async () => {
    await renderAndWait()
    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs[2].value).toBe('0')
  })

  it('renders artificial delay input with initial value 0', async () => {
    await renderAndWait()
    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs[3].value).toBe('0')
  })

  it('updates failure rate input', async () => {
    await renderAndWait()
    const inputs = screen.getAllByRole('spinbutton')
    await userEvent.clear(inputs[2])
    await userEvent.type(inputs[2], '25')
    expect(inputs[2].value).toBe('25')
  })

  it('calls POST /lab/config when Apply Lab Config is clicked', async () => {
    await renderAndWait()
    fireEvent.click(screen.getByRole('button', { name: 'Apply Lab Config' }))
    await waitFor(() =>
      expect(mock.history.post.some((r) => r.url.includes('/lab/config'))).toBe(true)
    )
  })
})

describe('App — reset button', () => {
  it('renders Reset button', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
  })

  it('calls POST /lab/reset when Reset is clicked', async () => {
    await renderAndWait()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() =>
      expect(mock.history.post.some((r) => r.url.includes('/lab/reset'))).toBe(true)
    )
  })

  it('zeroes traffic counters after reset', async () => {
    await renderAndWait()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    })
    await waitFor(() => {
      expect(screen.getByText('Sent').nextSibling.textContent).toBe('0')
    })
  })
})

describe('App — event timeline', () => {
  it('shows "No events yet" before any traffic', async () => {
    await act(async () => { render(<App />) })
    expect(screen.getByText('No events yet')).toBeInTheDocument()
  })

  it('adds a traffic-start event when Start Test is clicked', async () => {
    await renderAndWait()
    fireEvent.click(screen.getByRole('button', { name: 'Start Test' }))
    await waitFor(() =>
      expect(screen.queryByText('No events yet')).not.toBeInTheDocument()
    )
  })
})

describe('App — cluster feed panel', () => {
  it('shows namespace from /lab/cluster', async () => {
    await renderAndWait()
    expect(screen.getByText('default')).toBeInTheDocument()
  })

  it('shows data source from /lab/cluster', async () => {
    await renderAndWait()
    expect(screen.getByText('kubectl')).toBeInTheDocument()
  })
})

