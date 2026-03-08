# Architecture Index

This directory is the architecture entrypoint for Zeus domain knowledge.

Start here when you need the structural view of a subsystem before reading implementation files. Domain architecture docs should explain boundaries, runtime responsibilities, data flow, and the main files to inspect next.

## Current Domain Docs

- `document-flow.md`: document page, document tree, editor, comments, lock state, and related harness boundaries.
- `chat.md`: planned chat architecture index for session, streaming, and document-scoped chat behavior.
- `project-scope.md`: planned owner-scope and project resolution architecture index.
- `plugins.md`: planned plugin runtime and installation architecture index.

## Usage Rule

Root `AGENTS.md` should link to this directory instead of carrying full domain architecture inline. Add new domain architecture docs here when a subsystem becomes large enough that agents or engineers need a stable navigation layer.
