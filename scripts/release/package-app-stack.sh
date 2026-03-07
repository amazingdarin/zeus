#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_OUT="${1:-}"
BUILD_WEB="${BUILD_WEB:-0}"

if [[ -z "${STACK_OUT}" ]]; then
  echo "usage: $0 <stack-output-dir>"
  exit 1
fi

require_cmd() {
  local name="$1"
  command -v "${name}" >/dev/null 2>&1 || {
    echo "required command not found: ${name}"
    exit 1
  }
}

log() {
  echo "[package-app-stack] $*"
}

require_cmd npm
require_cmd rsync

FRONTEND_OUT="${STACK_OUT}/frontend"
BACKEND_OUT="${STACK_OUT}/backend"
APP_BACKEND_OUT="${BACKEND_OUT}/apps/app-backend"

log "output=${STACK_OUT}"

if [[ "${BUILD_WEB}" == "1" || ! -d "${ROOT_DIR}/apps/web/dist" ]]; then
  log "build web"
  (
    cd "${ROOT_DIR}/apps/web"
    npm run build
  )
else
  log "reuse web dist (${ROOT_DIR}/apps/web/dist)"
fi

log "build app-backend"
(
  cd "${ROOT_DIR}/apps/app-backend"
  npm run build
)

log "prepare output directories"
rm -rf "${FRONTEND_OUT}" "${BACKEND_OUT}"
mkdir -p "${FRONTEND_OUT}/dist" "${APP_BACKEND_OUT}" "${BACKEND_OUT}/packages" "${BACKEND_OUT}/node_modules/.pnpm"

log "copy web dist"
rsync -a --delete "${ROOT_DIR}/apps/web/dist/" "${FRONTEND_OUT}/dist/"

log "copy app-backend runtime files"
rsync -a --delete \
  --include="/dist/***" \
  --include="/node_modules/***" \
  --include="/data/***" \
  --include="/package.json" \
  --include="/.env.local.example" \
  --exclude="*" \
  "${ROOT_DIR}/apps/app-backend/" "${APP_BACKEND_OUT}/"

log "copy workspace package dependencies"
for pkg in shared plugin-sdk-shared plugin-sdk-backend; do
  rsync -a --delete "${ROOT_DIR}/packages/${pkg}/" "${BACKEND_OUT}/packages/${pkg}/"
done

log "copy pnpm virtual store (.pnpm)"
rsync -a --delete "${ROOT_DIR}/node_modules/.pnpm/" "${BACKEND_OUT}/node_modules/.pnpm/"

log "copy docs and ddl for system-docs/migrations"
rsync -a --delete "${ROOT_DIR}/docs/" "${BACKEND_OUT}/docs/"
rsync -a --delete "${ROOT_DIR}/ddl/" "${BACKEND_OUT}/ddl/"

cat > "${BACKEND_OUT}/start-app-backend.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}/apps/app-backend"
node dist/index.js
EOF
chmod +x "${BACKEND_OUT}/start-app-backend.sh"

cat > "${BACKEND_OUT}/start-app-backend.bat" <<'EOF'
@echo off
setlocal
cd /d "%~dp0apps\app-backend"
node dist\index.js
EOF

cat > "${STACK_OUT}/MANIFEST.txt" <<EOF
generated_at_utc=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
frontend_dist=${FRONTEND_OUT}/dist
backend_root=${BACKEND_OUT}
backend_entry=${BACKEND_OUT}/start-app-backend.sh
backend_app_dir=${APP_BACKEND_OUT}
EOF

log "done: ${STACK_OUT}"
