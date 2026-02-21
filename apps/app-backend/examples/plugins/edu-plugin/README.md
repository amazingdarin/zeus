# Edu Plugin (Sample, v2)

This directory contains a Zeus plugin v2 sample for educational question-set block authoring:

- `manifest.json` (pluginApiVersion=2)
- `frontend/index.mjs`

To package it as a store artifact:

```bash
cd apps/app-backend/examples/plugins/edu-plugin
tar -czf ../dist/edu-plugin-0.1.0.tgz manifest.json frontend
```

Then register the package URL and manifest in plugin store catalog.
