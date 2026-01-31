#!/usr/bin/env python3
"""
PaddleOCR-VL CLI Tool

Command-line interface for PaddleOCR-VL document parsing.
Can be called from Node.js via child_process.

Usage:
    python paddleocr_cli.py <image_path> [--output-format tiptap|markdown|raw] [--language zh|en|auto]

Output:
    JSON to stdout with the following structure:
    {
        "success": true,
        "content": { ... },  // Tiptap JSON or Markdown string
        "markdown": "...",   // Always include markdown
        "metadata": {
            "processing_time": 1.23,
            "model": "PaddleOCR-VL"
        }
    }
"""

import argparse
import base64
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

# Check if PaddleOCR is available
try:
    from paddleocr import PaddleOCRVL
    PADDLEOCR_AVAILABLE = True
except ImportError:
    PADDLEOCR_AVAILABLE = False

# ============================================================================
# Tiptap JSON Conversion
# ============================================================================

def markdown_to_tiptap(markdown: str) -> Dict[str, Any]:
    """
    Convert Markdown to Tiptap JSON format.
    This is a simplified converter for basic document structures.
    """
    lines = markdown.split('\n')
    content: List[Dict[str, Any]] = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        
        # Skip empty lines
        if not line.strip():
            i += 1
            continue
        
        # Headings
        if line.startswith('#'):
            level = 0
            for char in line:
                if char == '#':
                    level += 1
                else:
                    break
            level = min(level, 6)
            text = line[level:].strip()
            content.append({
                "type": "heading",
                "attrs": {"level": level},
                "content": [{"type": "text", "text": text}] if text else []
            })
            i += 1
            continue
        
        # Code blocks
        if line.startswith('```'):
            language = line[3:].strip() or None
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                code_lines.append(lines[i])
                i += 1
            i += 1  # Skip closing ```
            code_content = '\n'.join(code_lines)
            node: Dict[str, Any] = {
                "type": "codeBlock",
                "content": [{"type": "text", "text": code_content}] if code_content else []
            }
            if language:
                node["attrs"] = {"language": language}
            content.append(node)
            continue
        
        # Blockquotes
        if line.startswith('>'):
            quote_lines = []
            while i < len(lines) and lines[i].startswith('>'):
                quote_lines.append(lines[i][1:].strip())
                i += 1
            quote_text = ' '.join(quote_lines)
            content.append({
                "type": "blockquote",
                "content": [{
                    "type": "paragraph",
                    "content": [{"type": "text", "text": quote_text}] if quote_text else []
                }]
            })
            continue
        
        # Unordered lists
        if line.strip().startswith('- ') or line.strip().startswith('* '):
            list_items = []
            while i < len(lines) and (lines[i].strip().startswith('- ') or lines[i].strip().startswith('* ')):
                item_text = lines[i].strip()[2:]
                list_items.append({
                    "type": "listItem",
                    "content": [{
                        "type": "paragraph",
                        "content": [{"type": "text", "text": item_text}] if item_text else []
                    }]
                })
                i += 1
            content.append({
                "type": "bulletList",
                "content": list_items
            })
            continue
        
        # Ordered lists
        if line.strip() and line.strip()[0].isdigit() and '. ' in line:
            list_items = []
            while i < len(lines):
                stripped = lines[i].strip()
                if stripped and stripped[0].isdigit() and '. ' in stripped:
                    idx = stripped.index('. ')
                    item_text = stripped[idx + 2:]
                    list_items.append({
                        "type": "listItem",
                        "content": [{
                            "type": "paragraph",
                            "content": [{"type": "text", "text": item_text}] if item_text else []
                        }]
                    })
                    i += 1
                else:
                    break
            content.append({
                "type": "orderedList",
                "attrs": {"start": 1},
                "content": list_items
            })
            continue
        
        # Horizontal rule
        if line.strip() in ['---', '***', '___']:
            content.append({"type": "horizontalRule"})
            i += 1
            continue
        
        # Regular paragraph
        para_lines = []
        while i < len(lines) and lines[i].strip() and not lines[i].startswith('#') and not lines[i].startswith('```') and not lines[i].startswith('>'):
            para_lines.append(lines[i])
            i += 1
        
        if para_lines:
            para_text = ' '.join(para_lines)
            content.append({
                "type": "paragraph",
                "content": [{"type": "text", "text": para_text}] if para_text else []
            })
    
    return {
        "type": "doc",
        "content": content if content else [{"type": "paragraph", "content": []}]
    }


# ============================================================================
# OCR Service
# ============================================================================

class PaddleOCRCLI:
    """PaddleOCR-VL CLI wrapper"""
    
    def __init__(self, preload: bool = False):
        self.pipeline = None
        self._initialized = False
        if preload:
            self._ensure_initialized()
    
    def _ensure_initialized(self):
        """Lazy initialization of PaddleOCR pipeline"""
        if self._initialized:
            return
        
        if not PADDLEOCR_AVAILABLE:
            raise RuntimeError("PaddleOCR is not installed. Run: pip install paddleocr[doc-parser]")
        
        import logging
        logger = logging.getLogger("paddleocr-cli")
        logger.info("Loading PaddleOCR-VL model... (this may take a moment)")
        
        self.pipeline = PaddleOCRVL(
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_layout_detection=True
        )
        self._initialized = True
        logger.info("PaddleOCR-VL model loaded successfully")
    
    def process_image(self, image_path: str, output_format: str = "tiptap") -> Dict[str, Any]:
        """
        Process an image file with PaddleOCR-VL.
        
        Args:
            image_path: Path to the image file
            output_format: Output format ("tiptap", "markdown", or "raw")
        
        Returns:
            Dict with processing results
        """
        start_time = time.time()
        
        try:
            self._ensure_initialized()
            
            # Run OCR
            result = self.pipeline.predict(image_path)
            
            # Extract markdown from result
            if hasattr(result[0], 'save_to_markdown'):
                # PaddleOCR-VL returns structured result
                markdown = result[0].save_to_markdown()
            elif hasattr(result[0], 'rec_text'):
                # Fallback for basic OCR
                markdown = '\n'.join([item.rec_text for item in result if hasattr(item, 'rec_text')])
            else:
                # Raw result
                markdown = str(result)
            
            processing_time = time.time() - start_time
            
            # Build response
            response: Dict[str, Any] = {
                "success": True,
                "markdown": markdown,
                "metadata": {
                    "processing_time": round(processing_time, 3),
                    "model": "PaddleOCR-VL",
                    "source": image_path
                }
            }
            
            # Add formatted content
            if output_format == "tiptap":
                response["content"] = markdown_to_tiptap(markdown)
            elif output_format == "markdown":
                response["content"] = markdown
            else:  # raw
                response["content"] = {"raw": str(result)}
            
            return response
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "metadata": {
                    "processing_time": round(time.time() - start_time, 3),
                    "model": "PaddleOCR-VL"
                }
            }
    
    def process_base64(self, base64_data: str, output_format: str = "tiptap") -> Dict[str, Any]:
        """
        Process a base64-encoded image.
        
        Args:
            base64_data: Base64 string (with or without data URL prefix)
            output_format: Output format ("tiptap", "markdown", or "raw")
        
        Returns:
            Dict with processing results
        """
        import tempfile
        
        try:
            # Remove data URL prefix if present
            if ',' in base64_data:
                base64_data = base64_data.split(',', 1)[1]
            
            # Decode and save to temp file
            image_bytes = base64.b64decode(base64_data)
            
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
                tmp.write(image_bytes)
                tmp_path = tmp.name
            
            # Process
            result = self.process_image(tmp_path, output_format)
            
            # Cleanup
            Path(tmp_path).unlink(missing_ok=True)
            
            return result
            
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to process base64 image: {str(e)}",
                "metadata": {"model": "PaddleOCR-VL"}
            }


# ============================================================================
# Main Entry Point
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="PaddleOCR-VL CLI Tool for document parsing"
    )
    parser.add_argument(
        "input",
        help="Image file path or '-' to read base64 from stdin"
    )
    parser.add_argument(
        "--output-format", "-f",
        choices=["tiptap", "markdown", "raw"],
        default="tiptap",
        help="Output format (default: tiptap)"
    )
    parser.add_argument(
        "--language", "-l",
        choices=["zh", "en", "auto"],
        default="auto",
        help="Document language hint (default: auto)"
    )
    parser.add_argument(
        "--pretty", "-p",
        action="store_true",
        help="Pretty-print JSON output"
    )
    
    args = parser.parse_args()
    
    cli = PaddleOCRCLI()
    
    try:
        if args.input == "-":
            # Read base64 from stdin
            base64_data = sys.stdin.read().strip()
            result = cli.process_base64(base64_data, args.output_format)
        else:
            # Process file
            if not Path(args.input).exists():
                result = {
                    "success": False,
                    "error": f"File not found: {args.input}",
                    "metadata": {"model": "PaddleOCR-VL"}
                }
            else:
                result = cli.process_image(args.input, args.output_format)
        
        # Output JSON
        if args.pretty:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(json.dumps(result, ensure_ascii=False))
        
        sys.exit(0 if result.get("success") else 1)
        
    except Exception as e:
        error_result = {
            "success": False,
            "error": str(e),
            "metadata": {"model": "PaddleOCR-VL"}
        }
        print(json.dumps(error_result, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
