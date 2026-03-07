#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPS_ROOT="${DEPS_ROOT:-${ROOT_DIR}/dist/runtime-binaries}"
OUT_ROOT="${OUT_ROOT:-${ROOT_DIR}/dist/packages/desktop}"
PLATFORM="${1:-}"

if [[ -z "${PLATFORM}" ]]; then
  uname_s="$(uname -s | tr '[:upper:]' '[:lower:]')"
  uname_m="$(uname -m)"
  case "${uname_m}" in
    x86_64|amd64) arch="amd64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "unsupported arch: ${uname_m}"; exit 1 ;;
  esac
  case "${uname_s}" in
    darwin) os="darwin" ;;
    linux) os="linux" ;;
    mingw*|msys*|cygwin*) os="windows" ;;
    *) echo "unsupported os: ${uname_s}"; exit 1 ;;
  esac
  PLATFORM="${os}-${arch}"
fi

APP_OUT="${OUT_ROOT}/${PLATFORM}/app"
DEPS_OUT="${OUT_ROOT}/${PLATFORM}/deps"
STACK_OUT="${OUT_ROOT}/${PLATFORM}/stack"

echo "[package-desktop] platform=${PLATFORM}"
echo "[package-desktop] build desktop"
cd "${ROOT_DIR}/apps/desktop"
cargo tauri build

echo "[package-desktop] collect app artifacts"
rm -rf "${APP_OUT}" "${DEPS_OUT}" "${STACK_OUT}"
mkdir -p "${APP_OUT}" "${DEPS_OUT}" "${STACK_OUT}"

if [[ -d "${ROOT_DIR}/apps/desktop/target/release/bundle" ]]; then
  cp -R "${ROOT_DIR}/apps/desktop/target/release/bundle/." "${APP_OUT}/"
else
  echo "desktop bundle not found: ${ROOT_DIR}/apps/desktop/target/release/bundle"
  exit 1
fi

if [[ -d "${DEPS_ROOT}/desktop/${PLATFORM}" ]]; then
  cp -R "${DEPS_ROOT}/desktop/${PLATFORM}/." "${DEPS_OUT}/"
else
  echo "runtime deps not found for ${PLATFORM}: ${DEPS_ROOT}/desktop/${PLATFORM}"
  exit 1
fi

echo "[package-desktop] collect app stack artifacts (frontend + app-backend)"
bash "${ROOT_DIR}/scripts/release/package-app-stack.sh" "${STACK_OUT}"

cat > "${OUT_ROOT}/${PLATFORM}/MANIFEST.txt" <<EOF
platform=${PLATFORM}
generated_at_utc=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
app_dir=${APP_OUT}
deps_dir=${DEPS_OUT}
stack_dir=${STACK_OUT}
EOF

echo "[package-desktop] done: ${OUT_ROOT}/${PLATFORM}"
