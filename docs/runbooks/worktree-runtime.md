# Worktree Runtime

Use `scripts/dev/worktree-env.mjs` to derive deterministic runtime metadata for the current worktree.

## Output Contract

The script reports:

- `worktreeName`
- `ports.web`
- `ports.appBackend`
- `ports.server`
- `artifactRoot`
- `seedNamespace`

## Usage

```bash
node scripts/dev/worktree-env.mjs --json
```

Use these values to avoid cross-worktree collisions when expanding Zeus into a worktree-native harness engineering setup.
