# K8s Demo Shop

A simple full-stack application designed for learning Kubernetes concepts. This project demonstrates containerization, service discovery, and basic microservices architecture.

## Project Architecture

```
┌─────────────┐
│   Frontend  │ (React + Vite)
│  Port 3000  │
└──────┬──────┘
       │ HTTP
       ▼
┌─────────────┐
│   Backend   │ (Node.js + Express)
│  Port 3001  │
└──────┬──────┘
       │ TCP
       ▼
┌─────────────┐
│    Redis    │ (Cache & Counter)
│  Port 6379  │
└─────────────┘
```

## Folder Structure

```
k8s-demo-shop/
├── frontend/               # React + Vite application
│   ├── src/
│   │   ├── App.jsx        # Main component
│   │   ├── App.css        # Styling
│   │   ├── main.jsx       # Entry point
│   │   └── index.css      # Global styles
│   ├── Dockerfile         # Multi-stage build
│   ├── package.json
│   ├── vite.config.js
│   └── index.html
├── backend/                # Node.js + Express server
│   ├── server.js          # Express application
│   ├── Dockerfile         # Container image
│   ├── package.json
│   └── .dockerignore
├── docker-compose.yml      # Orchestration for local development
├── .env.example           # Environment variables template
└── README.md              # This file
```

## Quick Start

### Prerequisites

- Docker & Docker Compose installed
- Node.js 18+ (optional, for local development)

### Running with Docker Compose

```bash
cd k8s-demo-shop
docker compose up --build
```

The application will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **Redis**: localhost:6379

### Running Locally (Development)

#### Backend
```bash
cd backend
npm install
npm run dev
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

You'll need a Redis instance running locally. Start it with:
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

Then update `.env` or set environment variables:
```bash
export REDIS_HOST=localhost
export REDIS_PORT=6379
export PORT=3001
```

## API Endpoints

### GET /
Returns application status and metrics.

**Response:**
```json
{
  "message": "Hello from Kubernetes",
  "hostname": "container-id-or-hostname",
  "visits": 123,
  "time": "2024-01-15T10:30:45.123Z"
}
```

### GET /info
Returns detailed application information including pod name, IP, and version.

**Response:**
```json
{
  "hostname": "container-id-or-hostname",
  "pod": "container-id-or-hostname",
  "ip": "172.17.0.3",
  "visits": 123,
  "version": "1.0.0",
  "time": "2024-01-15T10:30:45.123Z"
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "healthy"
}
```

## Environment Variables

### Backend
- `PORT` - Server port (default: 3001)
- `REDIS_HOST` - Redis hostname (default: localhost)
- `REDIS_PORT` - Redis port (default: 6379)

### Frontend
- `VITE_BACKEND_URL` - Backend API URL (default: http://localhost:3001)

## Features

### Frontend
- Real-time metrics display
- Auto-refresh every 2 seconds
- Backend status indicator
- Container hostname display
- Visit counter
- Server time display
- Responsive design
- Modern gradient UI

### Backend
- Express.js REST API
- Redis integration for persistent counter
- Health check endpoint
- Container hostname reporting
- CORS enabled
- Environment-based configuration

## Docker Compose Overview

The `docker-compose.yml` file orchestrates three services:

1. **Redis**: In-memory data store for visit counter
2. **Backend**: Node.js API server
3. **Frontend**: React web application

Services communicate via a custom Docker network (`k8s-demo-network`).

Health checks ensure services are ready before dependent services start.

## Ports

| Service  | Port | Purpose |
|----------|------|---------|
| Frontend | 3000 | Web UI |
| Backend  | 3001 | REST API |
| Redis    | 6379 | Data store |

## Next Steps - Kubernetes

This application is designed to prepare you for deploying to Kubernetes. You'll manually create:

- **Deployment manifests** - Pod specifications and replicas
- **Service manifests** - Internal and external networking
- **ConfigMaps** - Environment configuration
- **Secrets** - Sensitive data management
- **Persistent Volumes** - Redis data persistence
- **Ingress** - External HTTP routing

Each Kubernetes resource will help you understand core concepts like:
- Container orchestration
- Service discovery
- Configuration management
- Networking policies
- State persistence

## Code Quality

- Clean, minimal comments
- Environment variable configuration
- Proper error handling
- Production-ready multi-stage Docker builds
- Health checks for all services
- CORS properly configured

## License

MIT
