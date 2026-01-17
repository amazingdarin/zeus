# DOC-EDITOR-OPENAPI PACKAGE

OpenAPI viewer nodes and components for the doc editor.

## STRUCTURE
```
frontend/packages/doc-editor-openapi/src/
├── nodes/     # OpenAPI node types
├── viewer/    # Swagger UI wrapper
└── lib/       # OpenAPI filtering helpers
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| OpenAPI node | src/nodes/openapi-node | tiptap node + styles |
| Ref node | src/nodes/openapi-ref-node | ref node + styles |
| Viewer | src/viewer/OpenApiSpecViewer.tsx | swagger-ui-react wrapper |

## CONVENTIONS
- Viewer wraps Swagger UI; avoid direct DOM manipulation.
