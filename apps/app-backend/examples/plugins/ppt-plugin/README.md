# PPT Plugin (Sample, v2)

This directory contains a Zeus plugin v2 sample:

- `manifest.json` (pluginApiVersion=2)
- `frontend/index.mjs`
- `backend/index.mjs`

To package it as a store artifact:

```bash
cd apps/app-backend/examples/plugins/ppt-plugin
tar -czf ../dist/ppt-plugin-0.3.0.tgz manifest.json frontend backend
```

Then add the package URL and manifest to your plugin store catalog.
