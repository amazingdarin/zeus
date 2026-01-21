# FRONTEND OVERVIEW

React + Vite + Tauri app with workspace packages for doc editor.

## STRUCTURE
```
frontend/
├── zeus/                # main React app
├── packages/            # shared editor packages
├── src-tauri/           # Tauri desktop shell (Rust)
├── tests/               # frontend tests
└── vite.config.ts       # Vite config
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App entry | frontend/zeus/src/main.tsx | React bootstrap |
| Routes | frontend/zeus/src/App.tsx | router + layout |
| UI components | frontend/zeus/src/components | Ant Design usage |
| API clients | frontend/zeus/src/api | backend calls |
| Doc editor | frontend/packages/doc-editor | Tiptap editor |
| OpenAPI nodes | frontend/packages/doc-editor/src/nodes/openapi-* | Swagger UI viewer |
| Tauri shell | frontend/src-tauri/src/main.rs | DO NOT REMOVE windows flag |

## CONVENTIONS
- UI framework: Ant Design.
- Workspace packages under `frontend/packages/*`.
