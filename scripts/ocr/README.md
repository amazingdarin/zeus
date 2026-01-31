# PaddleOCR-VL 服务

基于 PaddleOCR-VL (0.9B) 视觉语言模型的文档解析服务，支持 109 种语言，能够识别文本、表格、公式等文档元素。

## 功能特性

- **多语言支持**: 支持 109 种语言的文档识别
- **丰富的文档元素**: 文本、表格、公式、图表等
- **高精度**: 基于 NaViT + ERNIE-4.5 架构
- **多种输出格式**: Tiptap JSON、Markdown、原始结果

## 环境要求

### 硬件要求

| 配置 | 最低要求 | 推荐配置 |
|------|----------|----------|
| GPU 显存 | 4GB | 8GB+ |
| CUDA 版本 | 11.2+ | 12.6+ |
| 计算能力 (CC) | 7.0+ | 8.0+ |

### 软件要求

- Python 3.8+
- PaddlePaddle 3.x

## 安装

### 1. 安装 PaddlePaddle

**GPU 版本 (CUDA 12.6)**:
```bash
pip install paddlepaddle-gpu==3.2.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/
```

**CPU 版本**:
```bash
pip install paddlepaddle==3.2.0
```

### 2. 安装依赖

```bash
cd scripts/ocr
pip install -r requirements.txt
```

## 使用方式

### 方式一: HTTP 服务模式 (推荐)

启动服务:
```bash
python paddleocr_server.py --port 8001
```

服务启动后，Zeus 后端会自动检测并使用 PaddleOCR 服务。

**API 端点**:

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/ocr/parse` | POST | 解析上传的图片/PDF |
| `/api/ocr/parse-base64` | POST | 解析 Base64 编码的图片 |
| `/api/ocr/health` | GET | 健康检查 |
| `/api/ocr/info` | GET | 服务信息 |

**示例请求**:
```bash
curl -X POST http://localhost:8001/api/ocr/parse-base64 \
  -H "Content-Type: application/json" \
  -d '{"image": "data:image/png;base64,..."}'
```

### 方式二: CLI 模式

直接处理文件:
```bash
python paddleocr_cli.py /path/to/image.png --output-format tiptap
```

从标准输入读取 Base64:
```bash
echo "data:image/png;base64,..." | python paddleocr_cli.py - --output-format markdown
```

**参数说明**:

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--output-format`, `-f` | 输出格式 (tiptap/markdown/raw) | tiptap |
| `--language`, `-l` | 语言提示 (zh/en/auto) | auto |
| `--pretty`, `-p` | 格式化 JSON 输出 | false |

## 配置

### 环境变量

在 `apps/app-backend/.env` 中配置:

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ENABLE_PADDLE_OCR` | 是否启用 PaddleOCR 服务 | false |
| `PADDLE_OCR_PORT` | PaddleOCR 服务端口 | 8001 |
| `PADDLE_OCR_URL` | PaddleOCR 服务地址（外部服务时使用） | http://localhost:8001 |
| `PADDLE_OCR_PYTHON` | Python 解释器路径 | .venv/bin/python3 |

**示例配置**:
```env
# 启用 PaddleOCR（app-backend 会自动启动 Python 服务）
ENABLE_PADDLE_OCR=true
PADDLE_OCR_PORT=8001

# 或者连接外部 PaddleOCR 服务
# PADDLE_OCR_URL=http://ocr-server:8001
```

### 自动启动模式

当设置 `ENABLE_PADDLE_OCR=true` 时，app-backend 会自动启动 PaddleOCR Python 服务作为子进程。

**前提条件**:
- Python3 已安装并在 PATH 中
- PaddleOCR 依赖已安装 (`pip install -r scripts/ocr/requirements.txt`)

## 与 Zeus 集成

Zeus 后端会自动检测 PaddleOCR 服务的可用性:

1. **自动选择**: 如果 PaddleOCR 服务可用，优先使用它进行文档解析
2. **回退机制**: 如果 PaddleOCR 不可用，自动回退到 LLM 视觉模型
3. **手动选择**: 可以通过 API 参数指定使用的 OCR 提供商

**OCR API 参数**:

```json
{
  "image": "data:image/png;base64,...",
  "output_format": "tiptap",
  "provider": "paddle"  // 可选: "paddle", "llm", 或不指定 (自动)
}
```

## 输出格式

### Tiptap JSON

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 1 },
      "content": [{ "type": "text", "text": "文档标题" }]
    },
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "段落内容..." }]
    }
  ]
}
```

### Markdown

```markdown
# 文档标题

段落内容...
```

## 故障排除

### 常见问题

**1. CUDA 版本不兼容**
```
RuntimeError: CUDA error: no kernel image is available for execution on the device
```
解决: 检查 CUDA 版本，确保安装了正确版本的 PaddlePaddle

**2. 内存不足**
```
RuntimeError: CUDA out of memory
```
解决: 减少图片分辨率，或使用更大显存的 GPU

**3. 服务连接失败**
```
PaddleOCR service is not available
```
解决: 确保 PaddleOCR 服务已启动并监听正确端口

### 日志查看

服务日志会输出到控制台，包含处理时间和结果信息。

## 参考链接

- [PaddleOCR 官方文档](https://www.paddleocr.ai/)
- [PaddleOCR-VL 使用教程](https://www.paddleocr.ai/latest/version3.x/pipeline_usage/PaddleOCR-VL.html)
- [PaddlePaddle 安装指南](https://www.paddlepaddle.org.cn/install/quick)
