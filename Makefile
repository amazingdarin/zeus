APP_NAME := zeus
HELM_CHART := deploy/helm/charts
HELM_NAMESPACE ?= zeus

.PHONY: run-backend run-frontend install uninstall dev-install build-postgres-image

run-backend:
	go run ./cmd/zeus

run-frontend:
	cd frontend && npm run tauri dev

install:
	helm dependency build $(HELM_CHART)
	helm upgrade --install $(APP_NAME) $(HELM_CHART) --namespace $(HELM_NAMESPACE) --create-namespace

uninstall:
	helm uninstall $(APP_NAME) --namespace $(HELM_NAMESPACE)

dev-install:
	helm dependency build $(HELM_CHART)
	helm upgrade --install $(APP_NAME) $(HELM_CHART) --namespace $(HELM_NAMESPACE) --create-namespace --set global.hostNetwork=true

build-postgres-image:
	docker build -t zeus/postgres:pg15-zhparser -f deploy/postgres/Dockerfile .
