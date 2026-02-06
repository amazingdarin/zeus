# Harbor Deployment (k3s)

This directory contains a standalone Harbor deployment for k3s.

## Files

- `values.yaml`: Harbor base values (NodePort exposure, single-node scheduling)
- `values.s3.yaml.example`: Optional S3-compatible registry backend example (copy to `values.s3.yaml`, which is gitignored)
- `install.sh`: install/upgrade script

## Requirements

- `kubectl`
- `helm`
- `deploy/k3s.yaml` is valid and can access the cluster

## Install

```bash
chmod +x deploy/harbor/install.sh
deploy/harbor/install.sh
```

## S3 Backend (Optional)

If you want Harbor registry data stored in S3-compatible object storage:

1. Copy `values.s3.yaml.example` to `values.s3.yaml` and fill in your real endpoint/bucket/keys.
2. Re-run `install.sh`. The script auto-loads `values.s3.yaml` when present.

## Optional Environment Variables

- `KUBECONFIG_PATH` (default: `deploy/k3s.yaml`)
- `NAMESPACE` (default: `harbor`)
- `RELEASE_NAME` (default: `harbor`)
- `HARBOR_CHART_VERSION` (default: `1.18.2`)
- `HARBOR_ADMIN_PASSWORD` (default: `Harbor12345`)
- `HARBOR_NODEPORT_HTTP` (default: `30002`)
- `HARBOR_NODEPORT_HTTPS` (default: `30003`)
- `HARBOR_EXTERNAL_URL` (default: `http://<k8s-api-host>:30002`)
- `STORAGE_CLASS` (default: `local-path`)

## Notes

- Harbor admin password is stored in Secret `harbor-admin-password`.
- Default admin user is `admin`.
