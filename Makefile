APP_NAME := zeus
HELM_CHART := deploy/helm/charts
HELM_NAMESPACE ?= zeus
NAMESPACE ?= $(HELM_NAMESPACE)
CONFIG_PATH ?= /tmp/zeus-$(NAMESPACE)/config.yaml

.PHONY: run-server run-code-runner run-app-backend run-app-web run-app-desktop init-app-mobile-android init-app-mobile-ios run-app-mobile-android run-app-mobile-ios build-app-mobile-android build-app-mobile-ios install uninstall dev-install build-postgres-image build-backend-image build-frontend-image build-paddleocr-image download-runtime-binaries package-desktop package-mobile-android package-mobile-ios package-mobile package-all start-deps start-deps-dev stop-deps stop-deps-dev clean-deps start-all stop-all clean-all test-integration setup-python-venv install-paddleocr run-paddleocr-docker stop-paddleocr-docker

# Development run commands
run-server:
	cd server && go run ./cmd/zeus

run-code-runner:
	cd server && go run ./cmd/code-runner

run-app-backend:
	@# Load env vars from apps/app-backend/.env and override with apps/app-backend/.env.local (gitignored).
	@if [ -f apps/app-backend/.env ] || [ -f apps/app-backend/.env.local ]; then \
		[ -f apps/app-backend/.env ] && export $$(cat apps/app-backend/.env | grep -v '^#' | xargs); \
		[ -f apps/app-backend/.env.local ] && export $$(cat apps/app-backend/.env.local | grep -v '^#' | xargs); \
		cd apps/app-backend && npm run dev; \
	else \
		cd apps/app-backend && npm run dev; \
	fi

run-app-web:
	cd apps/web && npm run dev

run-app-desktop:
	@# Clean stale Tauri cache if the desktop crate was moved from the old frontend/src-tauri path.
	@if [ -d apps/desktop/target/debug/build ] && rg -q "frontend/src-tauri" apps/desktop/target/debug/build; then \
		echo "Detected stale Tauri cache in apps/desktop/target, cleaning..."; \
		rm -rf apps/desktop/target; \
	fi
	cd apps/desktop && cargo tauri dev

init-app-mobile-android:
	cd apps/desktop && cargo tauri android init --ci --skip-targets-install

init-app-mobile-ios:
	cd apps/desktop && cargo tauri ios init --ci --skip-targets-install

run-app-mobile-android:
	cd apps/desktop && cargo tauri android dev

run-app-mobile-ios:
	cd apps/desktop && cargo tauri ios dev

build-app-mobile-android:
	cd apps/desktop && cargo tauri android build

build-app-mobile-ios:
	cd apps/desktop && cargo tauri ios build

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

download-runtime-binaries:
	bash ./scripts/release/download-runtime-binaries.sh

package-desktop: download-runtime-binaries
	bash ./scripts/release/package-desktop.sh

package-mobile-android: download-runtime-binaries
	bash ./scripts/release/package-mobile.sh android

package-mobile-ios: download-runtime-binaries
	bash ./scripts/release/package-mobile.sh ios

package-mobile: package-mobile-android package-mobile-ios

package-all: package-desktop package-mobile

# PaddleOCR Docker commands
PADDLEOCR_IMAGE := zeus/paddleocr:latest
PADDLEOCR_CONTAINER := zeus-paddleocr
PADDLEOCR_PORT ?= 8001

build-paddleocr-image:
	@echo "Building PaddleOCR Docker image..."
	docker build -t $(PADDLEOCR_IMAGE) -f deploy/paddleocr/Dockerfile .
	@echo "PaddleOCR image built: $(PADDLEOCR_IMAGE)"

run-paddleocr-docker:
	@echo "Starting PaddleOCR container on port $(PADDLEOCR_PORT)..."
	@docker rm -f $(PADDLEOCR_CONTAINER) 2>/dev/null || true
	docker run -d \
		--name $(PADDLEOCR_CONTAINER) \
		-p $(PADDLEOCR_PORT):8001 \
		--restart unless-stopped \
		$(PADDLEOCR_IMAGE)
	@echo "PaddleOCR running at http://localhost:$(PADDLEOCR_PORT)"
	@echo "Configure this URL in Settings > OCR Document Recognition"

stop-paddleocr-docker:
	@echo "Stopping PaddleOCR container..."
	docker stop $(PADDLEOCR_CONTAINER) 2>/dev/null || true
	docker rm $(PADDLEOCR_CONTAINER) 2>/dev/null || true
	@echo "PaddleOCR container stopped."

start-deps:
	bash ./scripts/gen-config.sh $(NAMESPACE) $(CONFIG_PATH)
	helm dependency build $(HELM_CHART)
	-kubectl create namespace $(NAMESPACE)
	helm upgrade --install $(APP_NAME) $(HELM_CHART) --namespace $(NAMESPACE) --create-namespace -f deploy/helm/values.deps.yaml
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/postgres --timeout=120s
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/rustfs --timeout=120s
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/faster-whisper --timeout=180s

start-deps-dev:
	bash ./scripts/gen-config.sh $(NAMESPACE) $(CONFIG_PATH)
	helm dependency build $(HELM_CHART)
	-kubectl create namespace $(NAMESPACE)
	helm upgrade --install $(APP_NAME) $(HELM_CHART) --namespace $(NAMESPACE) --create-namespace -f deploy/helm/values.deps-dev.yaml
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/postgres --timeout=120s
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/rustfs --timeout=120s
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/faster-whisper --timeout=180s

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
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/faster-whisper --timeout=180s
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/zeus-backend --timeout=120s
	-kubectl wait --namespace $(NAMESPACE) --for=condition=available deployment/zeus-frontend --timeout=120s

stop-all:
	helm uninstall $(APP_NAME) --namespace $(NAMESPACE) || true

clean-all:
	-kubectl delete namespace $(NAMESPACE)

test-integration:
	$(MAKE) start-deps NAMESPACE=zeus-test
	cd server && ZEUS_CONFIG_PATH=/tmp/zeus-zeus-test/config.yaml go test ./internal/... -run Integration -v || ( $(MAKE) clean-all NAMESPACE=zeus-test; exit 1 )
	$(MAKE) clean-all NAMESPACE=zeus-test

# Python environment setup
# PaddlePaddle requires Python 3.8-3.12
PYTHON_VENV := .venv
PYTHON_BIN := python3.12

setup-python-venv:
	@echo "Creating Python 3.12 virtual environment in $(PYTHON_VENV)..."
	@which $(PYTHON_BIN) > /dev/null || (echo "Error: $(PYTHON_BIN) not found. Install with: brew install python@3.12" && exit 1)
	$(PYTHON_BIN) -m venv $(PYTHON_VENV)
	@echo "Virtual environment created. Activate with:"
	@echo "  source $(PYTHON_VENV)/bin/activate"

install-paddleocr: setup-python-venv
	@echo "Installing PaddleOCR dependencies (CPU)..."
	$(PYTHON_VENV)/bin/python -m pip install --upgrade pip
	@echo "Installing PaddlePaddle (CPU version)..."
	$(PYTHON_VENV)/bin/python -m pip install paddlepaddle==3.3.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
	@echo "Installing PaddleOCR with doc-parser..."
	$(PYTHON_VENV)/bin/python -m pip install -U "paddleocr[doc-parser]"
	$(PYTHON_VENV)/bin/pip install -r scripts/ocr/requirements.txt
	@echo "PaddleOCR dependencies installed."

install-paddleocr-gpu: setup-python-venv
	@echo "Installing PaddleOCR dependencies (GPU CUDA 12.6)..."
	$(PYTHON_VENV)/bin/python -m pip install --upgrade pip
	@echo "Installing PaddlePaddle GPU..."
	$(PYTHON_VENV)/bin/python -m pip install paddlepaddle-gpu==3.3.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/
	@echo "Installing PaddleOCR with doc-parser..."
	$(PYTHON_VENV)/bin/python -m pip install -U "paddleocr[doc-parser]"
	$(PYTHON_VENV)/bin/pip install -r scripts/ocr/requirements.txt
	@echo "PaddleOCR GPU dependencies installed."
