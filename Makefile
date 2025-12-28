APP_NAME := zeus
HELM_CHART := deploy/helm/charts
HELM_NAMESPACE ?= zeus

.PHONY: run-backend install uninstall debug-postgres install-debug

run-backend:
	go run ./cmd/zeus

install:
	helm dependency build $(HELM_CHART)
	helm upgrade --install $(APP_NAME) $(HELM_CHART) --namespace $(HELM_NAMESPACE) --create-namespace

install-debug:
	helm dependency build $(HELM_CHART)
	helm upgrade --install $(APP_NAME) $(HELM_CHART) --namespace $(HELM_NAMESPACE) --create-namespace --set global.hostNetwork=true

uninstall:
	helm uninstall $(APP_NAME) --namespace $(HELM_NAMESPACE)
