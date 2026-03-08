# Chat Architecture

The Zeus chat domain spans `apps/web`, `apps/app-backend`, and owner-scoped project selection.

Primary web entrypoints live in the chat page, chat dock, and shared chat logic. Primary backend entrypoints live in project-scoped chat session and run routes. When changing chat behavior, start with the harness docs in `docs/evals/chat.md`, then inspect the chat API modules and streaming logic before touching UI rendering.

## Primary Areas

- Web: `apps/web/src/pages/ChatPage.tsx`, `apps/web/src/hooks/useChatLogic.tsx`, `apps/web/src/components/ChatDock.tsx`
- Backend: `apps/app-backend/src/router.ts` chat routes, `apps/app-backend/src/services/chat.ts`
- Shared: document-scope and SSE helpers under `apps/web/src/features/chat/`
