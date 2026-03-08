# Plugin Runtime Evals

Plugin runtime evals verify install state, frontend asset loading, runtime contribution registration, and project-scoped plugin data behavior.

## Planned Entry Points

- plugin install / enable smoke
- frontend asset load smoke
- local-data read/write harnesses
- plugin route/menu contribution checks

## Usage Rule

Stable plugin regressions should live under `tests/harness/plugins/`, while temporary debugging scripts remain outside the eval index until they are promoted into durable checks.
