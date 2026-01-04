package service

import (
	"context"

	"zeus/internal/domain"
)

type ContentJSON struct {
	Meta    map[string]interface{} `json:"meta"`
	Content TipTapNode             `json:"content"`
}

type TipTapNode struct {
	Type    string                 `json:"type"`
	Attrs   map[string]interface{} `json:"attrs,omitempty"`
	Content []TipTapNode           `json:"content,omitempty"`
	Text    string                 `json:"text,omitempty"`
}

type ContentParser interface {
	ParseTipTapContent(
		ctx context.Context,
		projectID string,
		documentID string,
		documentPath string,
		content *ContentJSON,
	) ([]*domain.SemanticItem, error)
}
