APP_NAME := zeus
HELM_CHART := deploy/helm/charts
HELM_NAMESPACE ?= zeus

.PHONY: run-backend install uninstall

run-backend:
	go run ./cmd/zeus

install:
	helm dependency build $(HELM_CHART)
	helm install $(APP_NAME) $(HELM_CHART) --namespace $(HELM_NAMESPACE) --create-namespace

uninstall:
	helm uninstall $(APP_NAME) --namespace $(HELM_NAMESPACE)
