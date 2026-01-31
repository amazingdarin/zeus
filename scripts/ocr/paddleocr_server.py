#!/usr/bin/env python3
"""
PaddleOCR-VL HTTP Server

A FastAPI-based HTTP server for PaddleOCR-VL document parsing.
Can be run as a standalone service or sidecar.

Usage:
    python paddleocr_server.py [--host 0.0.0.0] [--port 8001]

API Endpoints:
    POST /api/ocr/parse       - Parse image/PDF file
    POST /api/ocr/parse-base64 - Parse base64-encoded image
    GET  /api/ocr/health      - Health check
    GET  /api/ocr/info        - Service info
"""

import argparse
import base64
import logging
import os
import sys
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Import CLI module for shared functionality
from paddleocr_cli import PaddleOCRCLI, markdown_to_tiptap, PADDLEOCR_AVAILABLE

# ============================================================================
# Logging
# ============================================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("paddleocr-server")

# ============================================================================
# Global State
# ============================================================================

ocr_cli: Optional[PaddleOCRCLI] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler"""
    global ocr_cli
    
    logger.info("Initializing PaddleOCR-VL service...")
    
    if PADDLEOCR_AVAILABLE:
        # Preload model on startup for faster first request
        preload = os.environ.get("PADDLEOCR_PRELOAD", "true").lower() == "true"
        logger.info(f"Creating PaddleOCR CLI (preload={preload})...")
        ocr_cli = PaddleOCRCLI(preload=preload)
        if preload:
            logger.info("PaddleOCR-VL service ready (model preloaded)")
        else:
            logger.info("PaddleOCR-VL service ready (lazy initialization)")
    else:
        logger.warning("PaddleOCR not installed. OCR functionality will be unavailable.")
        ocr_cli = None
    
    yield
    
    logger.info("Shutting down PaddleOCR-VL service...")

# ============================================================================
# FastAPI App
# ============================================================================

app = FastAPI(
    title="PaddleOCR-VL Service",
    description="Document parsing service using PaddleOCR-VL",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# Request/Response Models
# ============================================================================

class ParseBase64Request(BaseModel):
    """Request model for base64 image parsing"""
    image: str  # Base64 encoded image (with or without data URL prefix)
    output_format: str = "tiptap"  # tiptap, markdown, raw
    language: str = "auto"  # zh, en, auto

class OCRResponse(BaseModel):
    """Response model for OCR results"""
    success: bool
    content: Optional[Any] = None
    markdown: Optional[str] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = {}

class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    paddleocr_available: bool
    model_loaded: bool

class InfoResponse(BaseModel):
    """Service info response"""
    name: str
    version: str
    model: str
    capabilities: List[str]

# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/api/ocr/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status="healthy" if PADDLEOCR_AVAILABLE else "degraded",
        paddleocr_available=PADDLEOCR_AVAILABLE,
        model_loaded=ocr_cli is not None and ocr_cli._initialized
    )

@app.get("/api/ocr/info", response_model=InfoResponse)
async def service_info():
    """Service information endpoint"""
    return InfoResponse(
        name="PaddleOCR-VL Service",
        version="1.0.0",
        model="PaddleOCR-VL (0.9B)",
        capabilities=[
            "text_recognition",
            "layout_detection",
            "table_recognition",
            "formula_recognition",
            "multi_language_support"
        ]
    )

@app.post("/api/ocr/parse", response_model=OCRResponse)
async def parse_file(
    file: UploadFile = File(...),
    output_format: str = Form(default="tiptap"),
    language: str = Form(default="auto")
):
    """
    Parse an uploaded image or PDF file.
    
    Args:
        file: The image or PDF file to parse
        output_format: Output format (tiptap, markdown, raw)
        language: Language hint (zh, en, auto)
    
    Returns:
        OCRResponse with parsed content
    """
    if ocr_cli is None:
        raise HTTPException(
            status_code=503,
            detail="PaddleOCR service is not available. Please install paddleocr."
        )
    
    # Validate output format
    if output_format not in ["tiptap", "markdown", "raw"]:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid output_format: {output_format}. Must be tiptap, markdown, or raw."
        )
    
    # Save uploaded file to temp location
    suffix = Path(file.filename or "image.png").suffix
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name
        
        logger.info(f"Processing file: {file.filename} ({len(content)} bytes)")
        
        # Process with OCR
        result = ocr_cli.process_image(tmp_path, output_format)
        
        return OCRResponse(**result)
        
    except Exception as e:
        logger.error(f"OCR processing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        # Cleanup temp file
        if 'tmp_path' in locals():
            Path(tmp_path).unlink(missing_ok=True)

@app.post("/api/ocr/parse-base64", response_model=OCRResponse)
async def parse_base64(request: ParseBase64Request):
    """
    Parse a base64-encoded image.
    
    Args:
        request: ParseBase64Request with image data
    
    Returns:
        OCRResponse with parsed content
    """
    if ocr_cli is None:
        raise HTTPException(
            status_code=503,
            detail="PaddleOCR service is not available. Please install paddleocr."
        )
    
    # Validate output format
    if request.output_format not in ["tiptap", "markdown", "raw"]:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid output_format: {request.output_format}. Must be tiptap, markdown, or raw."
        )
    
    logger.info(f"Processing base64 image ({len(request.image)} chars)")
    
    try:
        result = ocr_cli.process_base64(request.image, request.output_format)
        return OCRResponse(**result)
        
    except Exception as e:
        logger.error(f"OCR processing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ocr/convert-to-tiptap")
async def convert_markdown_to_tiptap(markdown: str = Form(...)):
    """
    Convert Markdown to Tiptap JSON format.
    
    This is a utility endpoint that doesn't require PaddleOCR.
    
    Args:
        markdown: Markdown text to convert
    
    Returns:
        Tiptap JSON content
    """
    try:
        tiptap_content = markdown_to_tiptap(markdown)
        return JSONResponse({
            "success": True,
            "content": tiptap_content
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# Main Entry Point
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="PaddleOCR-VL HTTP Server"
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host to bind to (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8001,
        help="Port to listen on (default: 8001)"
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload for development"
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Number of worker processes (default: 1)"
    )
    
    args = parser.parse_args()
    
    logger.info(f"Starting PaddleOCR-VL server on {args.host}:{args.port}")
    
    uvicorn.run(
        "paddleocr_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        workers=args.workers
    )


if __name__ == "__main__":
    main()
