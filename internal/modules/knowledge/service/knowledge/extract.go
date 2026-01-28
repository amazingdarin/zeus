package knowledge

import (
	"fmt"
	"strings"

	"zeus/internal/domain"
)

func extractDocumentText(doc *domain.Document) string {
	if doc == nil {
		return ""
	}
	var parts []string
	if title := strings.TrimSpace(doc.Meta.Title); title != "" {
		parts = append(parts, title)
	}

	switch typed := doc.Body.Content.(type) {
	case map[string]any:
		parts = append(parts, extractTextFromNode(typed)...)
	case []any:
		parts = append(parts, extractTextFromNode(typed)...)
	case string:
		if strings.TrimSpace(typed) != "" {
			parts = append(parts, typed)
		}
	case nil:
		// ignore
	default:
		parts = append(parts, fmt.Sprintf("%v", typed))
	}

	joined := strings.Join(parts, "\n")
	return strings.TrimSpace(joined)
}

func extractTextFromNode(node any) []string {
	switch typed := node.(type) {
	case map[string]any:
		return extractTextFromMap(typed)
	case []any:
		return extractTextFromSlice(typed)
	default:
		return nil
	}
}

func extractTextFromMap(node map[string]any) []string {
	parts := make([]string, 0)
	if textValue, ok := node["text"]; ok {
		if text, ok := textValue.(string); ok {
			text = strings.TrimSpace(text)
			if text != "" {
				parts = append(parts, text)
			}
		}
	}
	if child, ok := node["content"]; ok {
		parts = append(parts, extractTextFromNode(child)...)
	}
	return parts
}

func extractTextFromSlice(items []any) []string {
	parts := make([]string, 0)
	for _, item := range items {
		parts = append(parts, extractTextFromNode(item)...)
	}
	return parts
}
