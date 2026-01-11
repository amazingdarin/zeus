package rag

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	domainrag "zeus/internal/domain/rag"
	"zeus/internal/repository"
)

// RAGExtractor is a replaceable strategy for turning a document into RAG units.
// Keep extraction logic isolated so rebuild rules can evolve independently.
type RAGExtractor interface {
	Extract(ctx context.Context, doc repository.Document) ([]domainrag.RAGUnit, error)
}

// SimpleBlockExtractor is a phase-1 TipTap extractor that walks block nodes.
type SimpleBlockExtractor struct{}

func (e SimpleBlockExtractor) Extract(ctx context.Context, doc repository.Document) ([]domainrag.RAGUnit, error) {
	if len(doc.ContentJSON) == 0 {
		return []domainrag.RAGUnit{}, nil
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(doc.ContentJSON, &payload); err != nil {
		return nil, fmt.Errorf("parse content json: %w", err)
	}
	content, _ := payload["content"].(map[string]interface{})
	if content == nil {
		return []domainrag.RAGUnit{}, nil
	}
	rawBlocks, ok := content["content"].([]interface{})
	if !ok {
		return []domainrag.RAGUnit{}, nil
	}
	units := make([]domainrag.RAGUnit, 0)
	blockIndex := 0
	walkBlocks(rawBlocks, func(block map[string]interface{}) {
		text := strings.TrimSpace(extractText(block))
		unitID := fmt.Sprintf("%s:%s:%d", doc.ProjectID, doc.DocID, blockIndex)
		source := domainrag.RAGSourceRef{DocID: doc.DocID, BlockIndex: blockIndex}
		blockIndex++
		if len([]rune(text)) < 20 {
			return
		}
		units = append(units, domainrag.RAGUnit{
			UnitID:    unitID,
			ProjectID: doc.ProjectID,
			DocID:     doc.DocID,
			Path:      doc.Path,
			Content:   text,
			Hash:      hashContent(text),
			Source:    source,
		})
	})
	return units, nil
}

func walkBlocks(nodes []interface{}, emit func(map[string]interface{})) {
	for _, node := range nodes {
		obj, ok := node.(map[string]interface{})
		if !ok {
			continue
		}
		typeName, _ := obj["type"].(string)
		if isBlockType(typeName) {
			emit(obj)
			continue
		}
		child, ok := obj["content"].([]interface{})
		if !ok || len(child) == 0 {
			continue
		}
		walkBlocks(child, emit)
	}
}

func isBlockType(typeName string) bool {
	switch typeName {
	case "paragraph", "heading", "codeBlock", "blockquote", "listItem":
		return true
	default:
		return false
	}
}

func extractText(node map[string]interface{}) string {
	var builder strings.Builder
	collectText(node, &builder)
	return builder.String()
}

func collectText(node map[string]interface{}, builder *strings.Builder) {
	if node == nil {
		return
	}
	if text, ok := node["text"].(string); ok {
		builder.WriteString(text)
		builder.WriteString(" ")
		return
	}
	content, ok := node["content"].([]interface{})
	if !ok {
		return
	}
	for _, child := range content {
		childMap, ok := child.(map[string]interface{})
		if !ok {
			continue
		}
		collectText(childMap, builder)
	}
}

func hashContent(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}
