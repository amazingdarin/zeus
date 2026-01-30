APP_NAME := zeus
HELM_CHART := deploy/helm/charts
HELM_NAMESPACE ?= zeus
NAMESPACE ?= $(HELM_NAMESPACE)
CONFIG_PATH ?= /tmp/zeus-$(NAMESPACE)/config.yaml

.PHONY: run-server run-app-backend run-app-web run-app-desktop install uninstall dev-install build-postgres-image build-backend-image build-frontend-image start-deps start-deps-dev stop-deps stop-deps-dev clean-deps start-all stop-all clean-all test-integration

# Development run commands
run-server:
	go run ./server/cmd/zeus

run-app-backend:
	cd apps/app-backend && npm run dev

run-app-web:
	cd apps/web && npm run dev

run-app-desktop:
	cd apps/desktop && cargo tauri dev

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

build-backend-image:
	docker build -t zeus:latest -f server/Dockerfile server

build-frontend-image:
	docker build -t zeus-web:latest -f apps/web/Dockerfile apps/web

start-deps:
	bash ./scripts/gen-config.sh $(NAMESPACE) $(CONFIG_PATH)
	helm dependency build $(HELM_CHART)
	-kubectl create namespace $(NAMESPACE)
	helm upgrade --install $(APP_NAME) $(HELM_CHART) --namespace $(NAMESPACE) --create-namespace -f deploy/helm/values.deps.yaml
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/postgres --timeout=120s
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/rustfs --timeout=120s

start-deps-dev:
	bash ./scripts/gen-config.sh $(NAMESPACE) $(CONFIG_PATH)
	helm dependency build $(HELM_CHART)
	-kubectl create namespace $(NAMESPACE)
	helm upgrade --install $(APP_NAME) $(HELM_CHART) --namespace $(NAMESPACE) --create-namespace -f deploy/helm/values.deps-dev.yaml
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/postgres --timeout=120s
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/rustfs --timeout=120s

stop-deps:
	helm uninstall $(APP_NAME) --namespace $(NAMESPACE) || true

stop-deps-dev:
	helm uninstall $(APP_NAME) --namespace $(NAMESPACE) || true

clean-deps:
	-kubectl delete namespace $(NAMESPACE)

start-all:
	bash ./scripts/gen-config.sh $(NAMESPACE) $(CONFIG_PATH)
	helm dependency build $(HELM_CHART)
	-kubectl create namespace $(NAMESPACE)
	helm upgrade --install $(APP_NAME) $(HELM_CHART) --namespace $(NAMESPACE) --create-namespace -f deploy/helm/values.full.yaml
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/postgres --timeout=120s
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/rustfs --timeout=120s
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/zeus-backend --timeout=120s
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/zeus-frontend --timeout=120s

stop-all:
	helm uninstall $(APP_NAME) --namespace $(NAMESPACE) || true

clean-all:
	-kubectl delete namespace $(NAMESPACE)

test-integration:
	$(MAKE) start-deps NAMESPACE=zeus-test
	ZEUS_CONFIG_PATH=/tmp/zeus-zeus-test/config.yaml go test ./server/internal/... -run Integration -v || ( $(MAKE) clean-all NAMESPACE=zeus-test; exit 1 )
	$(MAKE) clean-all NAMESPACE=zeus-test
