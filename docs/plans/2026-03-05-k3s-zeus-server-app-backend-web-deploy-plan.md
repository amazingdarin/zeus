# Zeus k3s (server + app-backend + web) Deployment Plan

> Cluster: gz k3s (`/Users/darin/mine/code/homeserver/secrets/kubeconfig_gz_cluster.yaml`)
> Date: 2026-03-05

## 1. Current State and Dependency Gap

### Already deployed

- `ingress-nginx` (namespace `ingress-nginx`)
- `postgres` (namespace `postgres`)
- `langfuse` (namespace `langfuse`)

### Missing base dependency

- None for current server + app-backend + web deployment.

## 2. Deploy Strategy

### 2.1 Split deployment by layer

1. Zeus core services:
   - Deploy Go `server` + Web `frontend` via root chart `deploy/helm/charts`.
   - Keep base dependencies disabled in root values (postgres only).
2. App backend:
   - Deploy separately via new chart `deploy/helm/app-backend`.

### 2.2 Scheduling policy

- Zeus workloads use default k3s scheduler behavior (no fixed node binding).
- If later you need pinning, set `backend.nodeSelector` / `frontend.nodeSelector` / app-backend `nodeSelector` explicitly.

### 2.3 Ingress route split rule

- Keep Go `server` ingress on `/api`.
- Route `app-backend` with explicit prefixes only:
  - `/api/projects/personal`
  - `/api/projects/team`
  - other app-backend prefixes (`/api/settings`, `/api/skills`, ...).

Do not use app-backend ingress path `/api/projects`, otherwise it will hijack server-side `/api/projects` project management API.

## 3. Image Build and Push

### 3.1 Build images

```bash
cd /Users/darin/mine/code/zeus
make build-backend-image
# Optional mirror override if Docker Hub timeout:
# make build-app-backend-image APP_BACKEND_NODE_IMAGE=m.daocloud.io/docker.io/library/node:22-alpine
make build-app-backend-image
make build-frontend-image
```

### 3.2 Tag and push example

```bash
docker tag zeus:latest 43.139.120.149:30002/zeus/server:v20260305
docker tag zeus/app-backend:latest 43.139.120.149:30002/zeus/app-backend:v20260305
docker tag zeus-web:latest 43.139.120.149:30002/zeus/web:v20260305

docker push 43.139.120.149:30002/zeus/server:v20260305
docker push 43.139.120.149:30002/zeus/app-backend:v20260305
docker push 43.139.120.149:30002/zeus/web:v20260305
```

## 4. Namespace and Secrets

```bash
KUBECONFIG=/Users/darin/mine/code/homeserver/secrets/kubeconfig_gz_cluster.yaml

kubectl --kubeconfig "$KUBECONFIG" create namespace zeus --dry-run=client -o yaml | kubectl --kubeconfig "$KUBECONFIG" apply -f -

# Copy/prepare image pull secret in zeus namespace
kubectl --kubeconfig "$KUBECONFIG" -n postgres get secret harbor-regcred \
  -o jsonpath='{.data.\.dockerconfigjson}' \
  | base64 --decode >/tmp/harbor-regcred.json

kubectl --kubeconfig "$KUBECONFIG" -n zeus create secret generic harbor-regcred \
  --type=kubernetes.io/dockerconfigjson \
  --from-file=.dockerconfigjson=/tmp/harbor-regcred.json \
  --dry-run=client -o yaml \
  | kubectl --kubeconfig "$KUBECONFIG" apply -f -

rm -f /tmp/harbor-regcred.json
```

## 5. Deploy Zeus Core (server + web only)

Values file:

- `/Users/darin/mine/code/zeus/deploy/helm/values.zeus-core.k3s.yaml`

Command:

```bash
helm --kubeconfig "$KUBECONFIG" dependency build /Users/darin/mine/code/zeus/deploy/helm/charts

helm --kubeconfig "$KUBECONFIG" upgrade --install zeus \
  /Users/darin/mine/code/zeus/deploy/helm/charts \
  -n zeus \
  -f /Users/darin/mine/code/zeus/deploy/helm/values.zeus-core.k3s.yaml
```

## 6. Deploy app-backend

Chart:

- `/Users/darin/mine/code/zeus/deploy/helm/app-backend`

Values:

- `/Users/darin/mine/code/zeus/deploy/helm/app-backend/values.k3s.yaml`

Command:

```bash
helm --kubeconfig "$KUBECONFIG" upgrade --install zeus-app-backend \
  /Users/darin/mine/code/zeus/deploy/helm/app-backend \
  -n zeus \
  -f /Users/darin/mine/code/zeus/deploy/helm/app-backend/values.k3s.yaml
```

## 7. Verification Checklist

```bash
kubectl --kubeconfig "$KUBECONFIG" -n zeus get deploy,po,svc,ingress -o wide
kubectl --kubeconfig "$KUBECONFIG" -n zeus get po -o wide
```

Expected:

- `zeus-backend` Running
- `zeus-frontend` Running
- `zeus-app-backend` Running
- ingress host resolves to `ingress-nginx` endpoint (`100.64.0.2`)

API route split quick check:

```bash
curl -i http://zeus.tail.dkbgc.com/api/system
curl -i http://zeus.tail.dkbgc.com/api/projects
curl -i http://zeus.tail.dkbgc.com/api/settings/chat
```

- `/api/system` should be served by Go `server`.
- `/api/projects` (unscoped project management) should be served by Go `server`.
- `/api/settings/*` should be served by `app-backend`.

## 8. Notes

- Root chart now disables bundled postgres via:
  - `postgres.enabled: false`
- `rustfs` dependency and S3 bootstrap path are removed from current deployment chain.
- `app-backend` runtime image is added at:
  - `apps/app-backend/Dockerfile`
