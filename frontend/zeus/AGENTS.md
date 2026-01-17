# FRONTEND/ZEUS

Main React application (Ant Design UI).

## STRUCTURE
```
frontend/zeus/src/
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
| App shell | frontend/zeus/src/layout/AppShell.tsx | layout + chrome |
| Page routes | frontend/zeus/src/pages | page components |
| API calls | frontend/zeus/src/api | fetch wrappers |
| Models UI | frontend/zeus/src/components/ModelSettingsModal.tsx | runtime config UI |

## CONVENTIONS
- Keep API wiring in `src/api`.
- Prefer Ant Design components.
