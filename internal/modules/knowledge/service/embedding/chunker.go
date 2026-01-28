package embedding

import (
	"strings"

	"zeus/internal/domain"
)

const (
	defaultChunkSize = 800
	defaultOverlap   = 100
)

type BlockChunk struct {
	DocID      string
	BlockID    string
	ChunkIndex int
	Content    string
}

func BuildChunks(doc *domain.Document) []BlockChunk {
	if doc == nil {
		return nil
	}
	blocks := extractBlocks(doc.Body.Content)
	if len(blocks) == 0 {
		text := strings.TrimSpace(extractDocumentText(doc))
		if text == "" {
			return nil
		}
		return []BlockChunk{{
			DocID:      doc.Meta.ID,
			BlockID:    "",
			ChunkIndex: 0,
			Content:    text,
		}}
	}
	chunks := make([]BlockChunk, 0)
	for _, block := range blocks {
		text := strings.TrimSpace(block.Text)
		if text == "" {
			continue
		}
		if len([]rune(text)) <= defaultChunkSize {
			chunks = append(chunks, BlockChunk{
				DocID:      doc.Meta.ID,
				BlockID:    block.ID,
				ChunkIndex: 0,
				Content:    text,
			})
			continue
		}
		for idx, part := range splitWithOverlap(text, defaultChunkSize, defaultOverlap) {
			chunks = append(chunks, BlockChunk{
				DocID:      doc.Meta.ID,
				BlockID:    block.ID,
				ChunkIndex: idx,
				Content:    part,
			})
		}
	}
	return chunks
}

type blockText struct {
	ID   string
	Text string
}

func extractBlocks(content any) []blockText {
	blocks := make([]blockText, 0)
	collectBlocks(content, &blocks)
	return blocks
}

func collectBlocks(node any, blocks *[]blockText) {
	switch typed := node.(type) {
	case map[string]any:
		if isBlockNode(typed) {
			text := strings.TrimSpace(collectText(typed))
			if text != "" {
				*blocks = append(*blocks, blockText{ID: nodeAttrID(typed), Text: text})
			}
			return
		}
		if child, ok := typed["content"]; ok {
			collectBlocks(child, blocks)
		}
	case []any:
		for _, child := range typed {
			collectBlocks(child, blocks)
		}
	}
}

func isBlockNode(node map[string]any) bool {
	if node == nil {
		return false
	}
	if node["type"] == nil {
		return false
	}
	value, _ := node["type"].(string)
	switch value {
	case "paragraph", "heading", "codeBlock", "blockquote", "listItem", "taskItem":
		return true
	default:
		return false
	}
}

func nodeAttrID(node map[string]any) string {
	attrs, ok := node["attrs"].(map[string]any)
	if !ok {
		return ""
	}
	id, _ := attrs["id"].(string)
	return strings.TrimSpace(id)
}

func collectText(node map[string]any) string {
	var builder strings.Builder
	collectTextInto(node, &builder)
	return builder.String()
}

func collectTextInto(node map[string]any, builder *strings.Builder) {
	if node == nil {
		return
	}
	if node["type"] == "text" {
		if text, ok := node["text"].(string); ok {
			builder.WriteString(text)
		}
	}
	if node["type"] == "hardBreak" {
		builder.WriteByte('\n')
	}
	if child, ok := node["content"].([]any); ok {
		for _, item := range child {
			if childMap, ok := item.(map[string]any); ok {
				collectTextInto(childMap, builder)
			}
		}
	}
}

func splitWithOverlap(text string, size int, overlap int) []string {
	runes := []rune(text)
	if len(runes) == 0 {
		return nil
	}
	if size <= 0 {
		return []string{string(runes)}
	}
	if overlap < 0 {
		overlap = 0
	}
	step := size - overlap
	if step <= 0 {
		step = size
	}
	chunks := make([]string, 0)
	for start := 0; start < len(runes); start += step {
		end := start + size
		if end > len(runes) {
			end = len(runes)
		}
		chunks = append(chunks, string(runes[start:end]))
		if end == len(runes) {
			break
		}
	}
	return chunks
}
