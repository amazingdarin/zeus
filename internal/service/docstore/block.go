package docstore

import (
	"context"
	"fmt"
	"strings"
)

func (s *impl) GetBlockByID(
	ctx context.Context,
	projectID,
	docID,
	blockID string,
) (map[string]interface{}, error) {
	blockID = strings.TrimSpace(blockID)
	if blockID == "" {
		return nil, fmt.Errorf("block id is required")
	}

	doc, err := s.Get(ctx, projectID, docID)
	if err != nil {
		return nil, err
	}

	block, ok := findBlockByID(blockID, doc.Body.Content)
	if !ok {
		return nil, ErrBlockNotFound
	}
	return block, nil
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
