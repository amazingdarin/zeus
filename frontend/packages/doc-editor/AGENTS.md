# DOC-EDITOR PACKAGE

Tiptap-based document editor library used by the main app.

## STRUCTURE
```
frontend/packages/doc-editor/src/
├── templates/     # editor/viewer templates
├── hooks/         # reusable hooks
├── nodes/         # editor node implementations
├── ui/            # editor UI components
├── primitives/    # base UI building blocks
└── styles/        # shared styles
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Editor template | src/templates | main editor composition |
| Hooks | src/hooks | editor state helpers |
| Node types | src/nodes | tiptap nodes |
| OpenAPI nodes | src/nodes/openapi-* | Swagger UI viewer + filters |
| UI controls | src/ui | toolbar controls |

## CONVENTIONS
- Keep editor logic in hooks/templates.
- Node-specific styles live next to node code.
