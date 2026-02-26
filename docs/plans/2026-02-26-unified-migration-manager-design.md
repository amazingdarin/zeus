# Unified Migration Manager Design (Cross-Track, Cross-Database)

Date: 2026-02-26  
Status: Proposed and user-confirmed scope

## 1. Goals

1. Provide one migration system that supports different runtimes and database engines:
   - mobile: SQLite
   - desktop: SQLite + Qdrant + Meilisearch
   - server/web: Postgres + Qdrant + Meilisearch
2. Standardize migration folder naming:
   - `YYYYMMDD-NNN-vX.Y.Z`
   - Example: `20260301-001-v1.0.0`
3. Support upgrade/rollback by **system version** (app version), not only by raw migration id.
4. Support migration lifecycle operations:
   - apply, rollback, status, archive, baseline
5. Keep one unified execution interface for all targets.

## 2. Non-Goals

1. No direct file-level sync of Qdrant/Meilisearch indexes across devices.
2. No requirement that all tracks must move at exactly the same schema version for each app release.
3. No backward compatibility with ad-hoc `psql -f` execution behavior.

## 3. Core Model

## 3.1 Terms

1. `app_version`: system version delivered to users, for example `v1.1.0`.
2. `schema_version`: database target version label, also semver string like `v1.0.0`.
3. `track`: migration lane for one runtime + engine pair.
4. `migration_id`: folder name `YYYYMMDD-NNN-vX.Y.Z`.
5. `target`: runtime bundle (`mobile`, `desktop`, `server`) that maps to multiple tracks.

## 3.2 Track Names

1. `mobile.sqlite`
2. `desktop.sqlite`
3. `desktop.qdrant`
4. `desktop.meili`
5. `server.postgres`
6. `server.qdrant`
7. `server.meili`

## 3.3 Naming Rule

Regex:

```txt
^(?<date>\d{8})-(?<seq>\d{3})-(?<schema_version>v\d+\.\d+\.\d+)$
```

Sort key:

1. `date` ascending
2. `seq` ascending
3. tie-break by lexicographic `migration_id`

## 4. Directory Layout

```txt
ddl/
  release-matrix.yaml
  migrations/
    mobile.sqlite/
      20260301-001-v1.0.0/
        manifest.yaml
        up.sql
        down.sql
    desktop.sqlite/
      20260301-001-v1.0.0/
        manifest.yaml
        up.sql
        down.sql
    desktop.qdrant/
      20260301-001-v1.0.0/
        manifest.yaml
        up.ts
        down.ts
    desktop.meili/
      20260301-001-v1.0.0/
        manifest.yaml
        up.ts
        down.ts
    server.postgres/
      20260301-001-v1.0.0/
        manifest.yaml
        up.sql
        down.sql
    server.qdrant/
      ...
    server.meili/
      ...
  archive/
    <timestamp>/
      ...
  baselines/
    <track>/
      <schema_version>/
        baseline.sql
        metadata.yaml
```

## 5. App Version -> Schema Version Mapping

`release-matrix.yaml` is the single authority for version targeting.

Example behavior required by product:

- Upgrading to `v1.1.0` can intentionally target DB `v1.0.0`.

This is achieved with explicit mapping, not implicit assumptions.

## 6. Migration Metadata Schema

Each migration folder has `manifest.yaml`:

```yaml
id: 20260301-001-v1.0.0
track: server.postgres
engine: postgres
schema_version: v1.0.0
description: "create knowledge base tables"
reversible: true
requires_snapshot: false
depends_on: []
prechecks:
  - "extension:vector"
artifacts:
  up: up.sql
  down: down.sql
checksum:
  up_sha256: "<sha256>"
  down_sha256: "<sha256>"
```

For Qdrant/Meilisearch, `artifacts.up/down` can point to `*.ts` handlers.

## 7. Migration State Storage

One control store per runtime:

1. Server runtime: Postgres control tables.
2. Desktop/mobile runtime: local SQLite control DB (for all local tracks).

This avoids storing migration metadata inside Qdrant/Meili internals.

## 7.1 SQL DDL (Postgres)

```sql
CREATE TABLE IF NOT EXISTS zeus_migration_history (
  id BIGSERIAL PRIMARY KEY,
  track TEXT NOT NULL,
  migration_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  app_version TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  checksum_up TEXT,
  checksum_down TEXT,
  operator TEXT NOT NULL DEFAULT 'system',
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zeus_migration_history_track_id_direction_success
ON zeus_migration_history (track, migration_id, direction)
WHERE status = 'success';

CREATE TABLE IF NOT EXISTS zeus_migration_lock (
  track TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 7.2 SQL DDL (SQLite)

```sql
CREATE TABLE IF NOT EXISTS zeus_migration_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track TEXT NOT NULL,
  migration_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  app_version TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  checksum_up TEXT,
  checksum_down TEXT,
  operator TEXT NOT NULL DEFAULT 'system',
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zeus_migration_history_track_id_direction_success
ON zeus_migration_history (track, migration_id, direction)
WHERE status = 'success';

CREATE TABLE IF NOT EXISTS zeus_migration_lock (
  track TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL
);
```

## 8. Upgrade/Rollback Algorithms

## 8.1 Upgrade by app version

Input: `target`, `app_version`

1. Resolve tracks from target.
2. For each track, read target `schema_version` from `release-matrix.yaml`.
3. Scan migration folders for the track, parse ids.
4. Select migrations where `schema_version <= target_schema_version`.
5. Remove already applied-success `up` migrations.
6. Acquire lock.
7. Execute remaining migrations in ascending order.
8. Record status transitions (`running -> success|failed`).
9. Release lock.

## 8.2 Rollback by app version

Input: `target`, `app_version`

1. Resolve tracks from target.
2. For each track, resolve target `schema_version`.
3. Find applied-success `up` migrations where `schema_version > target_schema_version`.
4. Execute `down` in descending order.
5. If `reversible=false`, fail fast unless `--restore-snapshot` is enabled.

## 8.3 Example required by product

If matrix declares:

- `app_version: v1.1.0`
- `server.postgres: v1.0.0`

Then:

```bash
zeus migrate up --target server --to-app-version v1.1.0
```

will execute only migrations whose schema version is `<= v1.0.0`.

## 9. Unified CLI

1. `zeus migrate plan --target <mobile|desktop|server> --to-app-version <vX.Y.Z>`
2. `zeus migrate up --target <...> --to-app-version <vX.Y.Z> [--track <name>] [--dry-run]`
3. `zeus migrate down --target <...> --to-app-version <vX.Y.Z> [--track <name>] [--dry-run]`
4. `zeus migrate status --target <...> [--track <name>]`
5. `zeus migrate archive --before-schema-version <vX.Y.Z> --output <path>`
6. `zeus migrate verify --target <...> --to-app-version <vX.Y.Z>`

Rules:

1. `--to-app-version` and `--to-schema-version` are mutually exclusive.
2. If both missing, default is latest app version in matrix.
3. `plan` never mutates state.

## 10. Archive and Baseline Strategy

1. Create baseline every quarter or every N migrations.
2. Move old migrations to `ddl/archive/<timestamp>/...`.
3. Keep metadata and checksums immutable for audit.
4. New environment bootstrap:
   - apply baseline
   - replay incremental migrations after baseline

## 11. Integration in Zeus

1. Keep current SQL content but move into per-track folders.
2. Replace ad-hoc `scripts/dev-skill.sh` migration execution with unified CLI.
3. Boot option:
   - `MIGRATION_AUTO_UPGRADE=true`
   - `MIGRATION_TARGET=server|desktop|mobile`
   - `MIGRATION_TO_APP_VERSION=<optional>`

## 12. Rollout Plan

1. Phase 1: introduce parser, matrix loader, plan/status command.
2. Phase 2: implement SQL tracks (`server.postgres`, `*.sqlite`) up/down.
3. Phase 3: add Qdrant/Meili adapters with snapshot-aware rollback.
4. Phase 4: archive/baseline commands and CI validation checks.

## 13. Validation Rules (CI)

1. Folder name matches regex.
2. `manifest.yaml` exists and is valid.
3. `schema_version` in folder name equals manifest.
4. Checksums are correct.
5. `release-matrix.yaml` references only existing track versions.
6. No duplicate `(track, migration_id)`.

