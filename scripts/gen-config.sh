#!/usr/bin/env bash
set -euo pipefail

namespace=${1:-zeus}
output=${2:-/tmp/zeus-${namespace}/config.yaml}

mkdir -p "$(dirname "$output")"

cat > "$output" <<EOF
server:
  addr: ":8080"

postgres:
  host: postgres.${namespace}.svc.cluster.local
  port: 5432
  user: zeus
  password: zeus
  database: zeus
  ssl_mode: disable
  time_zone: UTC
  max_open_conns: 10
  max_idle_conns: 5
  conn_max_lifetime: 30m

object_storage:
  endpoint: http://rustfs.${namespace}.svc.cluster.local:9000
  region: us-east-1
  access_key: zeus
  secret_key: zeus
  bucket: zeus-docs
  use_path_style: true
  insecure: true

asset:
  meta_root: /var/lib/zeus/assets

git:
  repo_root: /var/lib/zeus/repos
  session_repo_root: /var/lib/zeus/git-sessions
  bare_repo_root: /var/lib/zeus/git
  repo_url_prefix: ""
  author_name: Zeus
  author_email: zeus@local
  default_branch: main

search:
  index_root: /var/lib/zeus/index

security:
  encryption_key: zeus-dev-key
  encryption_keys: []
  active_key_id: ""
  active_key_version: 0

providers:
  copilot:
    client_id: "Ov23liPsn9jEM8DUvp3I"
    scopes: []
EOF

echo "$output"
