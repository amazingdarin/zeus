#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

KUBECONFIG_PATH="${KUBECONFIG_PATH:-${PROJECT_ROOT}/deploy/k3s.yaml}"
NAMESPACE="${NAMESPACE:-harbor}"
RELEASE_NAME="${RELEASE_NAME:-harbor}"
HARBOR_CHART_VERSION="${HARBOR_CHART_VERSION:-1.18.2}"
HARBOR_ADMIN_PASSWORD="${HARBOR_ADMIN_PASSWORD:-}"
HARBOR_NODEPORT_HTTP="${HARBOR_NODEPORT_HTTP:-30002}"
HARBOR_NODEPORT_HTTPS="${HARBOR_NODEPORT_HTTPS:-30003}"
STORAGE_CLASS="${STORAGE_CLASS:-local-path}"

api_server="$(kubectl --kubeconfig "${KUBECONFIG_PATH}" config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
api_host="$(echo "${api_server}" | sed -E 's#^https?://([^:/]+).*$#\1#')"
external_url_default="http://${api_host}:${HARBOR_NODEPORT_HTTP}"
HARBOR_EXTERNAL_URL="${HARBOR_EXTERNAL_URL:-${external_url_default}}"

echo "namespace=${NAMESPACE}"
echo "release=${RELEASE_NAME}"
echo "chart_version=${HARBOR_CHART_VERSION}"
echo "external_url=${HARBOR_EXTERNAL_URL}"

if [ -z "${HARBOR_ADMIN_PASSWORD}" ]; then
  echo "HARBOR_ADMIN_PASSWORD must be set" >&2
  exit 1
fi

kubectl --kubeconfig "${KUBECONFIG_PATH}" create namespace "${NAMESPACE}" --dry-run=client -o yaml | \
  kubectl --kubeconfig "${KUBECONFIG_PATH}" apply --validate=false -f -

kubectl --kubeconfig "${KUBECONFIG_PATH}" -n "${NAMESPACE}" create secret generic harbor-admin-password \
  --from-literal=HARBOR_ADMIN_PASSWORD="${HARBOR_ADMIN_PASSWORD}" \
  --dry-run=client -o yaml | \
  kubectl --kubeconfig "${KUBECONFIG_PATH}" apply --validate=false -f -

helm repo add harbor https://helm.goharbor.io >/dev/null 2>&1 || true
# Best-effort: upgrade can proceed using cached repo data.
helm repo update harbor >/dev/null || true

values_args=(-f "${SCRIPT_DIR}/values.yaml")
if [ -f "${SCRIPT_DIR}/values.s3.yaml" ]; then
  echo "using values.s3.yaml (S3 registry backend)"
  values_args+=(-f "${SCRIPT_DIR}/values.s3.yaml")
fi

helm --kubeconfig "${KUBECONFIG_PATH}" upgrade --install "${RELEASE_NAME}" harbor/harbor \
  --version "${HARBOR_CHART_VERSION}" \
  --namespace "${NAMESPACE}" \
  "${values_args[@]}" \
  --set-string expose.nodePort.ports.http.nodePort="${HARBOR_NODEPORT_HTTP}" \
  --set-string expose.nodePort.ports.https.nodePort="${HARBOR_NODEPORT_HTTPS}" \
  --set-string externalURL="${HARBOR_EXTERNAL_URL}" \
  --set-string persistence.persistentVolumeClaim.registry.storageClass="${STORAGE_CLASS}" \
  --set-string persistence.persistentVolumeClaim.jobservice.jobLog.storageClass="${STORAGE_CLASS}" \
  --set-string persistence.persistentVolumeClaim.database.storageClass="${STORAGE_CLASS}" \
  --set-string persistence.persistentVolumeClaim.redis.storageClass="${STORAGE_CLASS}" \
  --set-string persistence.persistentVolumeClaim.trivy.storageClass="${STORAGE_CLASS}"

kubectl --kubeconfig "${KUBECONFIG_PATH}" -n "${NAMESPACE}" get pods -o wide
kubectl --kubeconfig "${KUBECONFIG_PATH}" -n "${NAMESPACE}" get svc -o wide

echo "harbor deployed"
