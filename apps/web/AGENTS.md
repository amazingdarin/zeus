# FRONTEND/ZEUS

Main React application (Ant Design UI).

## STRUCTURE
```
apps/web/src/
├── components/   # UI components
├── pages/        # route pages
├── api/          # API client wrappers
├── layout/       # app shell
├── context/      # React context
├── hooks/        # hooks
└── utils/        # helpers
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| App shell | apps/web/src/layout/AppShell.tsx | layout + chrome |
| Page routes | apps/web/src/pages | page components |
| API calls | apps/web/src/api | fetch wrappers |
| Models UI | apps/web/src/components/ModelSettingsModal.tsx | runtime config UI |

## CONVENTIONS
- Keep API wiring in `src/api`.
- Prefer Ant Design components.
