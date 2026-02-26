# SQL Init Snapshots

Unified migration source of truth is under:

- `ddl/migrations/<track>/<migration-id>/`

This folder contains convenience init snapshots synced to `20260301-001-v1.0.0`:

- `init.server.postgres.sql`
- `init.mobile.sqlite.sql`
- `init.desktop.sqlite.sql`

Compatibility:

- `init.sql` is kept as an alias of `init.server.postgres.sql`.

Legacy sequence migrations were archived to:

- `ddl/archive/sql-migrations-legacy/`
