# PaddleOCR Docker Image
# Based on official PaddlePaddle Docker image
# Reference: https://www.paddlepaddle.org.cn/install/quick?docurl=/documentation/docs/zh/install/docker/macos-docker.html

# Use PaddlePaddle CPU image (for macOS compatibility)
# For GPU support, use: registry.baidubce.com/paddlepaddle/paddle:3.0.0-gpu-cuda12.6-cudnn9.5-trt10.6
FROM registry.baidubce.com/paddlepaddle/paddle:3.0.0

# Set working directory
WORKDIR /app

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

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
