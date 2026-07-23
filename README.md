# Kubernetes Behavior Lab

A hands-on Kubernetes observability lab built with a real multi-service stack. Visualize live pod behavior, HPA scaling events, per-pod CPU/memory usage, and replica changes — all from a browser dashboard backed by the Kubernetes API.

## What This Lab Does

- **Live cluster dashboard** — HPA status, replica overview, and per-pod CPU/memory updated every 2 seconds
- **Traffic generator** — fire configurable bursts of requests at the backend to trigger HPA scale-up
- **Pod tracking** — every response shows which exact pod served it (via `POD_NAME` downward API)
- **Visit counter** — Redis-backed counter shared across all backend replicas
- **In-cluster introspection** — backend reads the Kubernetes API using a least-privilege service account

## Architecture

```
┌─────────────────┐
│    Frontend     │  React + Vite → Nginx (port 80)
│  Lab Dashboard  │  polls /lab/cluster every 2s
└────────┬────────┘
         │ HTTP (Nginx proxy)
         ▼
┌─────────────────┐
│    Backend      │  Node.js + Express (port 3001)
│  Lab API        │  reads Kubernetes API in-cluster
└────────┬────────┘
         │ TCP
         ▼
┌─────────────────┐
│     Redis       │  visit counter + cache (port 6379)
└─────────────────┘
         │
         ▼
┌─────────────────┐
│  Kubernetes API │  pods / deployments / HPA / metrics
│  (in-cluster)   │  accessed via backend-observer SA
└─────────────────┘
```

## Folder Structure

```
k8s-demo-shop/
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Lab dashboard with cluster panels
│   │   ├── App.css
│   │   ├── main.jsx
│   │   └── index.css
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── vite.config.js
│   └── index.html
├── backend/
│   ├── server.js            # Express API + cluster introspection
│   ├── Dockerfile
│   └── package.json
├── k8s/
│   ├── deployment-backend.yaml
│   ├── deployment-frontend.yaml
│   ├── deployment-redis.yaml
│   ├── service-backend.yaml
│   ├── service-frontend.yaml
│   ├── service-redis.yaml
│   ├── hpa-backend.yaml
│   ├── rbac-backend-observer.yaml   # ServiceAccount + Role + RoleBinding
│   └── persistent-volume-claim.yaml
├── configmap.yaml
├── secret.yaml
└── README.md
```

## Kubernetes Quick Start

### Prerequisites

- Minikube (with metrics-server enabled) or any Kubernetes cluster
- kubectl configured
- Docker

### Enable Metrics Server (Minikube)

```powershell
minikube addons enable metrics-server
```

### Build and Load Images

```powershell
# Build
docker build -t k8s-demo-shop-backend:latest ./backend
docker build -t k8s-demo-shop-frontend:proxy-v1 ./frontend

# Load into Minikube
minikube image load k8s-demo-shop-backend:latest
minikube image load k8s-demo-shop-frontend:proxy-v1
```

### Apply All Resources

```powershell
kubectl apply -f configmap.yaml
kubectl apply -f secret.yaml
kubectl apply -f k8s/persistent-volume-claim.yaml
kubectl apply -f k8s/deployment-redis.yaml
kubectl apply -f k8s/service-redis.yaml
kubectl apply -f k8s/rbac-backend-observer.yaml
kubectl apply -f k8s/deployment-backend.yaml
kubectl apply -f k8s/service-backend.yaml
kubectl apply -f k8s/deployment-frontend.yaml
kubectl apply -f k8s/service-frontend.yaml
kubectl apply -f k8s/hpa-backend.yaml
```

### Verify

```powershell
kubectl get pods
kubectl get hpa
kubectl rollout status deployment/backend
kubectl rollout status deployment/frontend
```

### Open the Lab

```powershell
minikube service frontend-service
```

## Local Development

### Backend

```powershell
cd backend
npm install
npm run dev   # nodemon on port 3001
```

### Frontend

```powershell
cd frontend
npm install
npm run dev   # Vite on port 5173
```

### Redis (local)

```powershell
docker run -d -p 6379:6379 redis:7-alpine
```

> In local dev, `POD_NAME` falls back to `"local-dev"` and `/lab/cluster` uses `kubectl` instead of the in-cluster API.

## API Endpoints

### GET /
Returns visit count and which pod served the request.

```json
{
  "message": "Hello from Kubernetes",
  "hostname": "backend-6ddcfdd9b5-gjg2g",
  "visits": 42,
  "time": "2026-07-23T10:30:45.123Z"
}
```

### GET /info
Returns detailed pod identity information.

```json
{
  "hostname": "backend-6ddcfdd9b5-gjg2g",
  "pod": "backend-6ddcfdd9b5-gjg2g",
  "ip": "172.17.0.3",
  "visits": 42,
  "version": "1.0.0",
  "time": "2026-07-23T10:30:45.123Z"
}
```

### GET /lab/cluster
Returns a live snapshot of the cluster: deployments, HPA, and per-pod CPU/memory.

```json
{
  "namespace": "default",
  "source": "kube-api",
  "replicas": [
    { "name": "backend",  "desired": 2, "current": 2, "ready": 2 },
    { "name": "frontend", "desired": 2, "current": 2, "ready": 2 },
    { "name": "redis",    "desired": 1, "current": 1, "ready": 1 }
  ],
  "hpa": {
    "name": "backend-hpa",
    "minReplicas": 1, "maxReplicas": 5,
    "currentReplicas": 2, "desiredReplicas": 2,
    "currentCpuUtilization": 63,
    "currentCpuValue": "158m",
    "targetCpuUtilization": 50
  },
  "pods": [
    { "name": "backend-abc-1", "app": "backend", "cpuMillicores": 80, "memoryMiB": 28, "ready": true },
    { "name": "backend-abc-2", "app": "backend", "cpuMillicores": 78, "memoryMiB": 27, "ready": true },
    { "name": "frontend-xyz",  "app": "frontend", "cpuMillicores": 1,  "memoryMiB": 7,  "ready": true },
    { "name": "redis-xyz",     "app": "redis",    "cpuMillicores": 7,  "memoryMiB": 3,  "ready": true }
  ]
}
```

### GET /health
Liveness/readiness probe endpoint.

```json
{ "status": "healthy" }
```

## RBAC — backend-observer

The backend reads the Kubernetes API using a dedicated least-privilege service account defined in `k8s/rbac-backend-observer.yaml`:

| Resource | API Group | Verbs |
|----------|-----------|-------|
| pods | core | get, list, watch |
| deployments | apps | get, list, watch |
| horizontalpodautoscalers | autoscaling | get, list, watch |
| pods (metrics) | metrics.k8s.io | get, list |

The backend deployment binds to this service account and receives `POD_NAME` and `POD_NAMESPACE` via the downward API.

## Environment Variables

### Backend
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Express listen port |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `POD_NAME` | `local-dev` | Injected by downward API in cluster |
| `POD_NAMESPACE` | `default` | Injected by downward API in cluster |

### Frontend
| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_BACKEND_URL` | `http://localhost:3001` | Backend API base URL |

## HPA Behavior

The HPA (`k8s/hpa-backend.yaml`) targets the `backend` deployment:

- **CPU target**: 50%
- **Min replicas**: 1
- **Max replicas**: 5

To watch it in real time:

```powershell
kubectl get hpa -w
```

Use the traffic generator in the lab UI to push CPU above 50% and watch the dashboard scale up.

## Ports

| Service  | Port | Protocol |
|----------|------|----------|
| Frontend | 80 | HTTP (Nginx) |
| Backend  | 3001 | HTTP (Express) |
| Redis    | 6379 | TCP |

## Common Issues

### Redis pod Pending — PVC not found
Ensure `claimName` in `deployment-redis.yaml` matches the `metadata.name` in `persistent-volume-claim.yaml` exactly.

### /lab/cluster returns 500 locally
Requires `kubectl` to be installed and your kubeconfig pointing to a running cluster. In pure local dev with no cluster, the endpoint will fail gracefully.

### HPA shows `<unknown>` CPU
Metrics server is not running. Enable it:
```powershell
minikube addons enable metrics-server
```

### Backend 403 on /lab/cluster in cluster
The `rbac-backend-observer.yaml` was not applied, or the deployment is not using `serviceAccountName: backend-observer`. Re-apply both.

## License

MIT
