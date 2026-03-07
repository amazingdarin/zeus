#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPS_ROOT="${DEPS_ROOT:-${ROOT_DIR}/dist/runtime-binaries}"
OUT_ROOT="${OUT_ROOT:-${ROOT_DIR}/dist/packages/mobile}"
TARGET="${1:-}"

if [[ "${TARGET}" != "android" && "${TARGET}" != "ios" ]]; then
  echo "usage: $0 <android|ios>"
  exit 1
fi

if [[ "${TARGET}" == "android" ]]; then
  PLATFORM_DIR="android-arm64"
else
  PLATFORM_DIR="ios-arm64"
fi

APP_OUT="${OUT_ROOT}/${PLATFORM_DIR}/app"
DEPS_OUT="${OUT_ROOT}/${PLATFORM_DIR}/deps"
STACK_OUT="${OUT_ROOT}/${PLATFORM_DIR}/stack"

echo "[package-mobile] target=${TARGET}"
echo "[package-mobile] build mobile app"
cd "${ROOT_DIR}/apps/desktop"
if [[ "${TARGET}" == "android" ]]; then
  cargo tauri android build --target aarch64
else
  cargo tauri ios build
fi

echo "[package-mobile] collect app artifacts"
rm -rf "${APP_OUT}" "${DEPS_OUT}" "${STACK_OUT}"
mkdir -p "${APP_OUT}" "${DEPS_OUT}" "${STACK_OUT}"

if [[ "${TARGET}" == "android" ]]; then
  find "${ROOT_DIR}/apps/desktop/gen/android/app/build/outputs" \
    -type f \( -name "*.apk" -o -name "*.aab" \) -print0 \
    | while IFS= read -r -d '' f; do cp -f "${f}" "${APP_OUT}/"; done
else
  find "${ROOT_DIR}/apps/desktop/gen/apple" "${ROOT_DIR}/apps/desktop/target" \
    -type f \( -name "*.ipa" -o -name "*.app" \) -print0 2>/dev/null \
    | while IFS= read -r -d '' f; do cp -f "${f}" "${APP_OUT}/"; done
fi

if [[ -z "$(ls -A "${APP_OUT}" 2>/dev/null || true)" ]]; then
  echo "no mobile artifacts found for ${TARGET}"
  exit 1
fi

if [[ -d "${DEPS_ROOT}/mobile/${PLATFORM_DIR}" ]]; then
  cp -R "${DEPS_ROOT}/mobile/${PLATFORM_DIR}/." "${DEPS_OUT}/"
else
  echo "runtime deps not found for ${PLATFORM_DIR}: ${DEPS_ROOT}/mobile/${PLATFORM_DIR}"
  exit 1
fi

echo "[package-mobile] collect app stack artifacts (frontend + app-backend)"
bash "${ROOT_DIR}/scripts/release/package-app-stack.sh" "${STACK_OUT}"

cat > "${OUT_ROOT}/${PLATFORM_DIR}/MANIFEST.txt" <<EOF
target=${TARGET}
platform=${PLATFORM_DIR}
generated_at_utc=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
app_dir=${APP_OUT}
deps_dir=${DEPS_OUT}
stack_dir=${STACK_OUT}
EOF

echo "[package-mobile] done: ${OUT_ROOT}/${PLATFORM_DIR}"
