# HELM DEPLOYMENT

Root Helm chart for zeus + subcharts for postgres and rustfs.

## STRUCTURE
```
deploy/helm/
├── charts/                 # root chart + templates
│   ├── charts/postgres/    # postgres subchart (initdb configmap)
│   └── charts/rustfs/      # rustfs subchart
├── values.deps.yaml        # deps-only
├── values.deps-dev.yaml    # deps-only NodePort
└── values.full.yaml        # full stack (backend + frontend)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Root chart | charts/Chart.yaml | depends on postgres/rustfs |
| Backend/Frontend | charts/templates/* | Deployments/services/ingress |
| Postgres initdb | charts/charts/postgres/templates/configmap-initdb.yaml | loads files/init.sql |
| Postgres schema | charts/charts/postgres/files/init.sql | executed at initdb |
| Env values | values.*.yaml | deps/full/dev profiles |

## CONVENTIONS
- Init SQL must live under chart files/ to be loaded by .Files.Get.
- NodePort options are controlled via values.*.yaml.

## ANTI-PATTERNS
- Do not reference repo root paths in templates (Helm .Files cannot read them).
