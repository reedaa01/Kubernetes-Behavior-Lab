import { useState, useEffect } from 'react'
import axios from 'axios'
import './App.css'

function App() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const backendUrl = import.meta.env.VITE_BACKEND_URL || ''
        console.log("Backend URL:", backendUrl)
        const response = await axios.get(`${backendUrl}/info`)
        setData(response.data)
        setStatus('healthy')
        setError(null)
      } catch (err) {
        setStatus('unhealthy')
        setError(err.message)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 2000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="container">
      <div className="card">
        <h1>K8s Demo Shop</h1>
        
        <div className="info-grid">
          <div className="info-item">
            <label>Backend Status</label>
            <div className={`status ${status}`}>
              {status === 'healthy' ? '✓ Healthy' : status === 'unhealthy' ? '✗ Unhealthy' : '⟳ Loading...'}
            </div>
          </div>

          <div className="info-item">
            <label>Version</label>
            <div className="value">{data?.version || '—'}</div>
          </div>

          <div className="info-item">
            <label>Pod Name</label>
            <div className="value">{data?.pod || '—'}</div>
          </div>

          <div className="info-item">
            <label>Pod IP</label>
            <div className="value">{data?.ip || '—'}</div>
          </div>

          <div className="info-item">
            <label>Total Visits</label>
            <div className="value counter">{data?.visits ?? '—'}</div>
          </div>

          <div className="info-item">
            <label>Current Server Time</label>
            <div className="value time">
              {data?.time ? new Date(data.time).toLocaleTimeString() : '—'}
            </div>
          </div>
        </div>

        <div className="refresh-hint">
          Data refreshes every 2 seconds
        </div>
      </div>
    </div>
  )
}

export default App
