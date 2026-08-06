# 🚀 KubeLab – Production GitOps Pipeline on Azure Kubernetes Service


# End-to-End DevOps, GitOps & Kubernetes Platform on Microsoft Azure

KubeLab is a production-style DevOps project that demonstrates the complete software delivery lifecycle—from code commit to automated deployment on Azure Kubernetes Service (AKS).

The project combines CI/CD, GitOps, Kubernetes, monitoring, security, containerization, and cloud-native best practices into a single automated deployment platform.
---

## Table of Contents

1. [Architecture](#architecture)
2. [Prerequisites & Tech Stack](#prerequisites--tech-stack)
3. [Quick Start & Local Development](#quick-start--local-development)
4. [CI/CD & Pipeline Workflow](#cicd--pipeline-workflow)
5. [Environments & Deployment Targets](#environments--deployment-targets)
6. [Monitoring & Observability](#monitoring--observability)
7. [API Reference](#api-reference)
8. [RBAC](#rbac--backend-observer)

---

## Architecture


<img width="1672" height="941" alt="Architecture" src="https://github.com/user-attachments/assets/96fcab9e-4ade-4ed6-b7c5-1f871ead1038" />




**Key capabilities:**

- **Live cluster dashboard** — HPA status, replica overview, and per-pod CPU/memory updated every 2 seconds
- **Traffic generator** — fire configurable bursts of requests at the backend to trigger HPA scale-up
- **Pod tracking** — every response shows which exact pod served it (via `POD_NAME` downward API)
- **Visit counter** — Redis-backed counter shared across all backend replicas
- **In-cluster introspection** — backend reads the Kubernetes API using a least-privilege service account

---

## Prerequisites & Tech Stack

### Required Tools

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| `kubectl` | v1.28+ | Cluster management |
| `helm` | v3.14+ | Chart packaging & deployment |
| `docker` | v24+ | Building container images |
| `node` | v22 (LTS) | Local backend/frontend dev |
| `minikube` | v1.32+ | Local cluster (optional) |
| `argocd` CLI | v2.10+ | GitOps management (optional) |

### Permissions Required

| Scope | Requirement |
|-------|-------------|
| Azure Container Registry | Push access — service principal with `AcrPush` role |
| GitHub Actions | `AZURE_CREDENTIALS` secret (service principal JSON) and `ACR_NAME` secret |
| Kubernetes cluster | `cluster-admin` or a role with deploy/HPA/RBAC permissions in the target namespace |
| ArgoCD | Write access to the `kubelab` Application (to patch sync policy) |

---

## Quick Start & Local Development

### Environment Variables

**Backend** — create a `.env` in `backend/`:

```env
PORT=3001
REDIS_HOST=localhost
REDIS_PORT=6379
# Injected automatically by the downward API when running in-cluster:
# POD_NAME=local-dev
# POD_NAMESPACE=default
```

**Frontend** — create a `.env` in `frontend/`:

```env
VITE_BACKEND_URL=http://localhost:3001
```

### Local Dev (no cluster required)

```bash
# Terminal 1 — Redis
docker run -d -p 6379:6379 redis:7-alpine

# Terminal 2 — Backend (nodemon on :3001)
cd backend
npm install
npm run dev

# Terminal 3 — Frontend (Vite on :5173)
cd frontend
npm install
npm run dev
```

> In local dev, `POD_NAME` falls back to `"local-dev"` and `/lab/cluster` delegates to `kubectl` instead of the in-cluster API.

### Kubernetes Quick Start (Minikube)

```bash
# 1. Enable the metrics server add-on
minikube addons enable metrics-server

# 2. Build images and load them into Minikube's Docker daemon
docker build -t k8s-demo-shop-backend:latest ./backend
docker build -t k8s-demo-shop-frontend:latest ./frontend
minikube image load k8s-demo-shop-backend:latest
minikube image load k8s-demo-shop-frontend:latest

# 3. Apply manifests in dependency order
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

# 4. Verify
kubectl get pods
kubectl get hpa
kubectl rollout status deployment/backend
kubectl rollout status deployment/frontend

# 5. Open the lab
minikube service frontend-service
```

### Helm Deploy (production path)

```bash
helm upgrade --install kubelab ./kubelab \
  --set backend.image.tag=<sha> \
  --set frontend.image.tag=<sha> \
  --namespace default
```

---

## CI/CD & Pipeline Workflow

### Pipeline Files

| Workflow | File | Entry Trigger |
|----------|------|--------------|
| CI (lint, test, audit, build) | [.github/workflows/ci.yaml](.github/workflows/ci.yaml) | Push / PR → `main` |
| Publish Images | [.github/workflows/publish.yml](.github/workflows/publish.yml) | CI workflow completes successfully |
| Trivy Container Scan | [.github/workflows/trivy.yml](.github/workflows/trivy.yml) | Push → `main` |
| CodeQL Analysis | [.github/workflows/codeql.yml](.github/workflows/codeql.yml) | Push / PR → `main` |

### Branching Strategy

This project uses **Trunk-Based Development** with a single long-lived branch:

- `main` — only protected branch; all work merges here via pull requests.
- Feature work is done on short-lived branches (`feat/*`, `fix/*`) and merged via PR.
- No staging or release branches; the Helm `values.yaml` image tags act as the promotion mechanism.

### Trigger Conditions & Flow
<img width="1672" height="941" alt="diagram cicd" src="https://github.com/user-attachments/assets/f03a74f4-2352-4214-b876-9cecf7ba3b2d" />



ArgoCD sync policy is set via `argocd-syncpolicy-patch.json`:
```json
{"spec":{"syncPolicy":{"automated":{"enabled":true,"prune":true,"selfHeal":true}}}}
```

---

## Environments & Deployment Targets

| Environment | Branch | Cluster / Target | Cloud / Region | Notes |
|-------------|--------|-----------------|---------------|-------|
| **Local** | any | Minikube | Local machine | Manual `kubectl apply` or `helm install` |
| **Production** | `main` | AKS / Azure Kubernetes Service | Azure | GitOps via ArgoCD; images pushed to ACR |

> Additional environments (staging, preview) can be added by creating a new ArgoCD Application pointing to a separate namespace and Helm values file.

---

## Monitoring & Observability

### Metrics & Dashboards

| Tool | Access | What it shows |
|------|--------|--------------|
| **Prometheus** | `kubectl port-forward svc/prometheus-server 9090:80 -n monitoring` | Raw metrics scraped from pods and HPA |
| **Grafana** | `kubectl port-forward svc/monitoring-grafana 3000:80 -n monitoring` → [http://localhost:3000](http://localhost:3000) | CPU/memory per pod, HPA replica count, request rate |
| **Kubernetes Dashboard** | `minikube dashboard` | Pod status, events, resource usage |
| **Live Lab UI** | In-browser (`/lab/cluster` endpoint) | Real-time replica counts, HPA state, per-pod CPU/memory refreshed every 2 s |

### HPA Scaling Behaviour

The HPA (`k8s/hpa-backend.yaml`) targets the `backend` deployment:

| Setting | Value |
|---------|-------|
| CPU target utilization | 50 % |
| Min replicas | 1 |
| Max replicas | 5 |

Watch scaling events in real time:

```bash
kubectl get hpa -w
```

Use the traffic generator in the lab UI to push CPU above 50 % and observe the dashboard scale up.

### Alerting

Alerts are not pre-configured; recommended setup:

- Connect Grafana to a notification channel (Slack `#devops-alerts`, email, or PagerDuty).
- Add Prometheus `PrometheusRule` resources for pod-crash, HPA-maxed, and PVC-full conditions.

---

## API Reference

### `GET /`
Returns visit count and the pod that served the request.

```json
{
  "message": "Hello from Kubernetes",
  "hostname": "backend-6ddcfdd9b5-gjg2g",
  "visits": 42,
  "time": "2026-07-23T10:30:45.123Z"
}
```

### `GET /info`
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

### `GET /lab/cluster`
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

### `GET /health`
Liveness/readiness probe endpoint.

```json
{ "status": "healthy" }
```

---

## RBAC — backend-observer

The backend reads the Kubernetes API using a dedicated least-privilege service account defined in [k8s/rbac-backend-observer.yaml](k8s/rbac-backend-observer.yaml):

| Resource | API Group | Verbs |
|----------|-----------|-------|
| `pods` | core | `get`, `list`, `watch` |
| `deployments` | `apps` | `get`, `list`, `watch` |
| `horizontalpodautoscalers` | `autoscaling` | `get`, `list`, `watch` |
| `pods` (metrics) | `metrics.k8s.io` | `get`, `list` |

The backend `Deployment` binds to this service account and receives `POD_NAME` and `POD_NAMESPACE` via the downward API.

---

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Redis pod stuck `Pending` | PVC name mismatch | Ensure `claimName` in `deployment-redis.yaml` matches `metadata.name` in `persistent-volume-claim.yaml` |
| `/lab/cluster` returns 500 locally | No kubeconfig / no cluster | Requires `kubectl` pointing to a live cluster; endpoint fails gracefully when absent |
| HPA shows `<unknown>` CPU | Metrics server missing | `minikube addons enable metrics-server` |
| Backend 403 on `/lab/cluster` in cluster | RBAC not applied | Re-apply `k8s/rbac-backend-observer.yaml` and confirm `serviceAccountName: backend-observer` in the deployment |

---

## License

MIT
