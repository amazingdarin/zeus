# DOC-EDITOR PACKAGE

Tiptap-based editor library with custom nodes and UI primitives.

## STRUCTURE
```
frontend/packages/doc-editor/src/
├── templates/     # editor/viewer templates
├── hooks/         # reusable hooks
├── nodes/         # tiptap nodes (openapi, block-ref, image)
├── primitives/    # base UI building blocks
└── lib/           # tiptap + markdown helpers
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Editor composition | src/templates | doc editor + viewer templates |
| Node registry | src/nodes/index.ts | exported nodes |
| OpenAPI nodes | src/nodes/openapi-node | Swagger UI viewer |
| Block refs | src/nodes/block-ref-node | cross-block references |
| Markdown utils | src/lib/markdown.ts | conversions |

## CONVENTIONS
- Node-specific styles live beside node code (scss).
- Export public API from src/index.ts.
