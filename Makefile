APP_NAME := zeus
HELM_CHART := deploy/helm/charts
HELM_NAMESPACE ?= zeus
OAPI_SPEC := ddl/api/openapi.yaml
OAPI_CONFIG := oapi-codegen.yaml

.PHONY: run-backend run-frontend install uninstall debug-postgres install-debug gen-oapi

run-backend:
	go run ./cmd/zeus

run-frontend:
	cd frontend && npm run tauri dev

install:
	helm dependency build $(HELM_CHART)
	helm upgrade --install $(APP_NAME) $(HELM_CHART) --namespace $(HELM_NAMESPACE) --create-namespace

install-debug:
	helm dependency build $(HELM_CHART)
	helm upgrade --install $(APP_NAME) $(HELM_CHART) --namespace $(HELM_NAMESPACE) --create-namespace --set global.hostNetwork=true

uninstall:
	helm uninstall $(APP_NAME) --namespace $(HELM_NAMESPACE)

gen-oapi:
	go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen --config $(OAPI_CONFIG) $(OAPI_SPEC)
