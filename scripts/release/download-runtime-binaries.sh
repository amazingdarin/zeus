#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_ROOT="${OUT_ROOT:-${ROOT_DIR}/dist/runtime-binaries}"
TMP_ROOT="${OUT_ROOT}/.tmp"

SQLITE_YEAR="${SQLITE_YEAR:-2025}"
SQLITE_VERSION_NUM="${SQLITE_VERSION_NUM:-3500400}"   # 3.50.4 -> 3500400
QDRANT_VERSION="${QDRANT_VERSION:-v1.17.0}"
MEILI_VERSION="${MEILI_VERSION:-v1.36.0}"

command -v curl >/dev/null 2>&1 || { echo "curl is required"; exit 1; }
command -v unzip >/dev/null 2>&1 || { echo "unzip is required"; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "tar is required"; exit 1; }

mkdir -p "${OUT_ROOT}" "${TMP_ROOT}"

log() {
  echo "[runtime-binaries] $*"
}

download_file() {
  local url="$1"
  local out_file="$2"
  if [[ -s "${out_file}" ]]; then
    log "reuse: ${out_file}"
    return 0
  fi
  log "download: ${url}"
  curl -fL --retry 3 --retry-delay 2 -o "${out_file}" "${url}"
}

extract_zip() {
  local zip_file="$1"
  local out_dir="$2"
  rm -rf "${out_dir}"
  mkdir -p "${out_dir}"
  unzip -oq "${zip_file}" -d "${out_dir}"
}

extract_tar_gz() {
  local tar_file="$1"
  local out_dir="$2"
  rm -rf "${out_dir}"
  mkdir -p "${out_dir}"
  tar -xzf "${tar_file}" -C "${out_dir}"
}

download_sqlite_tools() {
  local platform="$1"
  local asset_name="$2"
  local url="https://www.sqlite.org/${SQLITE_YEAR}/${asset_name}-${SQLITE_VERSION_NUM}.zip"
  local zip_file="${TMP_ROOT}/${asset_name}-${SQLITE_VERSION_NUM}.zip"
  local out_dir="${OUT_ROOT}/desktop/${platform}/sqlite"
  download_file "${url}" "${zip_file}"
  extract_zip "${zip_file}" "${out_dir}"
}

download_sqlite_amalgamation() {
  local platform_family="$1" # desktop or mobile
  local platform="$2"
  local url="https://www.sqlite.org/${SQLITE_YEAR}/sqlite-amalgamation-${SQLITE_VERSION_NUM}.zip"
  local zip_file="${TMP_ROOT}/sqlite-amalgamation-${SQLITE_VERSION_NUM}.zip"
  local out_dir="${OUT_ROOT}/${platform_family}/${platform}/sqlite-amalgamation"
  download_file "${url}" "${zip_file}"
  extract_zip "${zip_file}" "${out_dir}"
}

download_qdrant() {
  local platform="$1"
  local asset_name="$2"
  local url="https://github.com/qdrant/qdrant/releases/download/${QDRANT_VERSION}/${asset_name}"
  local out_dir="${OUT_ROOT}/desktop/${platform}/qdrant"
  local tmp_file="${TMP_ROOT}/${asset_name}"
  download_file "${url}" "${tmp_file}"
  case "${asset_name}" in
    *.tar.gz)
      extract_tar_gz "${tmp_file}" "${out_dir}"
      ;;
    *.zip)
      extract_zip "${tmp_file}" "${out_dir}"
      ;;
    *)
      rm -rf "${out_dir}"
      mkdir -p "${out_dir}"
      cp -f "${tmp_file}" "${out_dir}/"
      ;;
  esac
}

download_meili() {
  local platform="$1"
  local asset_name="$2"
  local url="https://github.com/meilisearch/meilisearch/releases/download/${MEILI_VERSION}/${asset_name}"
  local out_dir="${OUT_ROOT}/desktop/${platform}/meilisearch"
  local tmp_file="${TMP_ROOT}/${asset_name}"
  download_file "${url}" "${tmp_file}"
  rm -rf "${out_dir}"
  mkdir -p "${out_dir}"
  cp -f "${tmp_file}" "${out_dir}/"
}

write_manifest() {
  cat > "${OUT_ROOT}/manifest.json" <<EOF
{
  "generated_at_utc": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "sqlite": {
    "year": "${SQLITE_YEAR}",
    "version_num": "${SQLITE_VERSION_NUM}"
  },
  "qdrant": {
    "version": "${QDRANT_VERSION}"
  },
  "meilisearch": {
    "version": "${MEILI_VERSION}"
  },
  "notes": [
    "mobile bundles use sqlite amalgamation source package",
    "desktop linux-arm64 currently uses sqlite amalgamation fallback due no official sqlite-tools linux arm64 archive"
  ]
}
EOF
}

log "output root: ${OUT_ROOT}"

# Desktop: sqlite + qdrant + meilisearch
download_sqlite_tools "linux-amd64" "sqlite-tools-linux-x64"
download_sqlite_tools "darwin-amd64" "sqlite-tools-osx-x64"
download_sqlite_tools "darwin-arm64" "sqlite-tools-osx-arm64"
download_sqlite_tools "windows-amd64" "sqlite-tools-win-x64"
download_sqlite_amalgamation "desktop" "linux-arm64"

download_qdrant "linux-amd64" "qdrant-x86_64-unknown-linux-gnu.tar.gz"
download_qdrant "linux-arm64" "qdrant-aarch64-unknown-linux-musl.tar.gz"
download_qdrant "darwin-amd64" "qdrant-x86_64-apple-darwin.tar.gz"
download_qdrant "darwin-arm64" "qdrant-aarch64-apple-darwin.tar.gz"
download_qdrant "windows-amd64" "qdrant-x86_64-pc-windows-msvc.zip"

download_meili "linux-amd64" "meilisearch-linux-amd64"
download_meili "linux-arm64" "meilisearch-linux-aarch64"
download_meili "darwin-amd64" "meilisearch-macos-amd64"
download_meili "darwin-arm64" "meilisearch-macos-apple-silicon"
download_meili "windows-amd64" "meilisearch-windows-amd64.exe"

# Mobile: sqlite only
download_sqlite_amalgamation "mobile" "android-arm64"
download_sqlite_amalgamation "mobile" "ios-arm64"

write_manifest
log "done"
