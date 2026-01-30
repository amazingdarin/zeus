# FRONTEND OVERVIEW

React + Vite + Tauri app with workspace packages for doc editor.

## STRUCTURE
```
apps/
├── web/                 # main React app
├── desktop/             # Tauri desktop shell (Rust)
packages/                # shared editor packages
frontend/                # tooling configs (vite/tsconfig)
tests/                   # frontend tests
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App entry | apps/web/src/main.tsx | React bootstrap |
| Routes | apps/web/src/App.tsx | router + layout |
| UI components | apps/web/src/components | Ant Design usage |
| API clients | apps/web/src/api | backend calls |
| Doc editor | packages/doc-editor | Tiptap editor |
| OpenAPI nodes | packages/doc-editor/src/nodes/openapi-* | Swagger UI viewer |
| Tauri shell | apps/desktop/src/main.rs | DO NOT REMOVE windows flag |

## CONVENTIONS
- UI framework: Ant Design.
- Workspace packages under `packages/*`.
