package document

import (
	"context"
	"fmt"
	"strings"

	"zeus/internal/domain/docstore"
)

func (s *Service) GetBlockByID(
	ctx context.Context,
	projectKey,
	docID,
	blockID string,
) (*docstore.Document, error) {
	blockID = strings.TrimSpace(blockID)
	if blockID == "" {
		return nil, fmt.Errorf("block id is required")
	}

	doc, err := s.Get(ctx, projectKey, docID)
	if err != nil {
		return nil, err
	}

	block, ok := findBlockByID(blockID, doc.Body.Content)
	if !ok {
		return nil, ErrBlockNotFound
	}

	filtered := *doc
	filtered.Body = docstore.DocumentBody{
		Type:    doc.Body.Type,
		Content: buildBlockContent(doc.Body.Content, block),
	}
	return &filtered, nil
}

func findBlockByID(blockID string, node interface{}) (map[string]interface{}, bool) {
	switch typed := node.(type) {
	case map[string]interface{}:
		if matchesBlockID(blockID, typed) {
			return typed, true
		}
		if childMap, ok := typed["content"].(map[string]interface{}); ok {
			if found, ok := findBlockByID(blockID, childMap); ok {
				return found, true
			}
		}
		if children, ok := typed["content"].([]interface{}); ok {
			for _, child := range children {
				if found, ok := findBlockByID(blockID, child); ok {
					return found, true
				}
			}
		}
	case []interface{}:
		for _, child := range typed {
			if found, ok := findBlockByID(blockID, child); ok {
				return found, true
			}
		}
	}
	return nil, false
}

func matchesBlockID(blockID string, node map[string]interface{}) bool {
	attrs, ok := node["attrs"].(map[string]interface{})
	if !ok {
		return false
	}
	id, _ := attrs["id"].(string)
	return strings.TrimSpace(id) == blockID
}

func buildBlockContent(content interface{}, block map[string]interface{}) interface{} {
	switch typed := content.(type) {
	case map[string]interface{}:
		if meta, ok := typed["meta"]; ok {
			return map[string]interface{}{
				"meta":    meta,
				"content": buildDocRoot(typed["content"], block),
			}
		}
		return buildDocRoot(typed, block)
	default:
		return buildDocRoot(nil, block)
	}
}

func buildDocRoot(root interface{}, block map[string]interface{}) map[string]interface{} {
	rootMap, ok := root.(map[string]interface{})
	if !ok {
		return map[string]interface{}{
			"type":    "doc",
			"content": []interface{}{block},
		}
	}
	next := make(map[string]interface{}, len(rootMap)+1)
	for key, value := range rootMap {
		if key == "content" {
			continue
		}
		next[key] = value
	}
	next["content"] = []interface{}{block}
	if _, ok := next["type"]; !ok {
		next["type"] = "doc"
	}
	return next
}
