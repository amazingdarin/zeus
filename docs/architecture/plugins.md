# Plugin Runtime Architecture

The Zeus plugin runtime spans install state, runtime manifests, frontend asset loading, backend execution, and project-scoped local data.

The main operational split is between plugin metadata and install state in `plugins-v2`, browser-side runtime assembly in `PluginRuntimeContext`, and plugin asset/runtime APIs exposed by `apps/app-backend`. Example plugins and installed plugin copies must remain aligned for harnesses to be trustworthy.

## Primary Areas

- Backend runtime: `apps/app-backend/src/plugins-v2/manager.ts`
- Web runtime: `apps/web/src/context/PluginRuntimeContext.tsx`
- Example plugins: `apps/app-backend/examples/plugins/`
- Installed plugin copies: `data/plugins/`
