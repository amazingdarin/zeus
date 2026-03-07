# Document Flow Architecture

The Zeus document flow spans `apps/web`, `apps/app-backend`, and the Go `server` project scope layer.

The web document page consumes project-scoped APIs for tree loading, document reading, comments, lock state, tabs, and related regression-sensitive behaviors. The harness for document flow should exercise these boundaries with seeded project data so regressions can be reproduced without tribal knowledge.
