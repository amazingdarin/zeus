# PaddleOCR Docker Image
# Based on Python 3.12 for multi-architecture support (amd64/arm64)

FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN pip install --no-cache-dir --upgrade pip

# Install PaddlePaddle CPU version from official source
# Note: Use different index for CPU version
RUN pip install --no-cache-dir paddlepaddle -i https://www.paddlepaddle.org.cn/packages/stable/cpu/

# Install PaddleOCR with doc-parser support
RUN pip install --no-cache-dir -U "paddleocr[doc-parser]"

# Install additional dependencies for the HTTP service
RUN pip install --no-cache-dir \
    fastapi>=0.115.0 \
    uvicorn>=0.32.0 \
    python-multipart>=0.0.9 \
    Pillow>=10.0.0 \
    PyMuPDF>=1.24.0 \
    orjson>=3.10.0

# Copy the OCR server script
COPY scripts/ocr/paddleocr_server.py /app/paddleocr_server.py

# Pre-download models (optional, makes first request faster)
# This downloads the default OCR models during build
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(use_angle_cls=True, lang='ch')" || true

# Expose the OCR service port
EXPOSE 8001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8001/api/ocr/health || exit 1

# Run the OCR service
CMD ["python", "/app/paddleocr_server.py", "--host", "0.0.0.0", "--port", "8001"]
