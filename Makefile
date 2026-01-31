APP_NAME := zeus
HELM_CHART := deploy/helm/charts
HELM_NAMESPACE ?= zeus
NAMESPACE ?= $(HELM_NAMESPACE)
CONFIG_PATH ?= /tmp/zeus-$(NAMESPACE)/config.yaml

.PHONY: run-server run-app-backend run-app-web run-app-desktop install uninstall dev-install build-postgres-image build-backend-image build-frontend-image build-paddleocr-image start-deps start-deps-dev stop-deps stop-deps-dev clean-deps start-all stop-all clean-all test-integration setup-python-venv install-paddleocr run-paddleocr-docker stop-paddleocr-docker

# Development run commands
run-server:
	cd server && go run ./cmd/zeus

run-app-backend:
	@if [ -f apps/app-backend/.env ]; then \
		export $$(cat apps/app-backend/.env | grep -v '^#' | xargs) && cd apps/app-backend && npm run dev; \
	else \
		cd apps/app-backend && npm run dev; \
	fi

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

# PaddleOCR Docker commands
PADDLEOCR_IMAGE := zeus/paddleocr:latest
PADDLEOCR_CONTAINER := zeus-paddleocr
PADDLEOCR_PORT ?= 8001

build-paddleocr-image:
	@echo "Building PaddleOCR Docker image (linux/amd64)..."
	docker build --platform linux/amd64 -t $(PADDLEOCR_IMAGE) -f deploy/paddleocr/Dockerfile .
	@echo "PaddleOCR image built: $(PADDLEOCR_IMAGE)"

run-paddleocr-docker:
	@echo "Starting PaddleOCR container on port $(PADDLEOCR_PORT)..."
	@docker rm -f $(PADDLEOCR_CONTAINER) 2>/dev/null || true
	docker run -d \
		--platform linux/amd64 \
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
