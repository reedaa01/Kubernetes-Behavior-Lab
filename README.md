# K8s Demo Shop

A simple full-stack application for learning Kubernetes concepts with a real multi-service setup. This project demonstrates Deployments, Services, ConfigMaps, Secrets, probes, and persistent storage using Redis.

## Project Architecture

```
┌─────────────┐
│   Frontend  │ (React + Vite)
│  Port 80    │
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
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── App.css
│   │   ├── main.jsx
│   │   └── index.css
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── vite.config.js
│   └── index.html
├── backend/
│   ├── server.js
│   ├── Dockerfile
│   └── package.json
├── k8s/
│   ├── deployment-backend.yaml
│   ├── deployment-frontend.yaml
│   ├── deployment-redis.yaml
│   ├── service-backend.yaml
│   ├── service-frontend.yaml
│   ├── service-redis.yaml
│   └── persistent-volume-claim.yaml
├── configmap.yaml
├── secret.yaml
└── README.md
```

## Kubernetes Quick Start

### Prerequisites

- Kubernetes cluster (for example Minikube)
- kubectl
- Docker images built and available in your cluster environment

### Apply Resources

```powershell
kubectl apply -f configmap.yaml
kubectl apply -f secret.yaml
kubectl apply -f k8s/persistent-volume-claim.yaml
kubectl apply -f k8s/deployment-redis.yaml
kubectl apply -f k8s/service-redis.yaml
kubectl apply -f k8s/deployment-backend.yaml
kubectl apply -f k8s/service-backend.yaml
kubectl apply -f k8s/deployment-frontend.yaml
kubectl apply -f k8s/service-frontend.yaml
```

### Verify

```powershell
kubectl get pods
kubectl get svc
kubectl rollout status deployment/backend
kubectl rollout status deployment/frontend
kubectl rollout status deployment/redis
```

## Local Development (Optional)

If you want to run the app outside Kubernetes:

### Backend
```bash
cd backend
npm install
npm start
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Run Redis locally:

```bash
docker run -d -p 6379:6379 redis:7-alpine
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

## Accessing The App On Kubernetes

- The frontend and backend Services are `NodePort`.
- To open in Minikube:

```powershell
minikube service frontend-service
```

## Kubernetes Notes

- Backend deployment includes liveness and readiness probes using `/health` on port `3001`.
- Redis deployment uses a PVC from `k8s/persistent-volume-claim.yaml`.
- The PVC name currently used by Redis deployment is `myredis-pvc`.

## Common Errors And Fixes

### 1) unknown field envFrom name
Cause: wrong nesting under `envFrom`.

Correct format:

```yaml
envFrom:
  - configMapRef:
      name: backend-config
  - secretRef:
      name: backend-secret
```

### 2) unknown field resource
Cause: using `resource` instead of `resources` in container spec.

Correct key:

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "256Mi"
  limits:
    cpu: "500m"
    memory: "512Mi"
```

### 3) unknown field containers[0].volumes
Cause: `volumes` placed inside a container block.

Fix: keep `volumeMounts` under container, and move `volumes` to `spec.template.spec` level.

### 4) redis pod Pending because pvc not found
Cause: mismatch between PVC metadata name and `claimName`.

Fix: ensure `claimName` in Redis deployment matches PVC metadata name exactly.

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

## Ports

| Service  | Port | Purpose |
|----------|------|---------|
| Frontend | 80   | Web UI (inside cluster/service port) |
| Backend  | 3001 | REST API |
| Redis    | 6379 | Data store |

## Next Steps

Useful improvements to continue learning:

- **Deployment manifests** - Pod specifications and replicas
- **Service manifests** - Internal and external networking
- **ConfigMaps** - Environment configuration
- **Secrets** - Sensitive data management
- **Persistent Volumes** - Redis data persistence
- **Ingress** - External HTTP routing

These resources help you practice core concepts like:
- Container orchestration
- Service discovery
- Configuration management
- Networking policies
- State persistence

## License

MIT
