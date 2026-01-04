package content_parser

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"zeus/internal/domain"
	"zeus/internal/service"
)

const (
	blockTypeHeading   = "heading"
	blockTypeParagraph = "paragraph"
	blockTypeCode      = "code"
	blockTypePlantUML  = "plantuml"
)

type contentParser struct{}

func NewContentParser() service.ContentParser {
	return &contentParser{}
}

func (p *contentParser) ParseTipTapContent(
	_ context.Context,
	projectID string,
	documentID string,
	documentPath string,
	content *service.ContentJSON,
) ([]*domain.SemanticItem, error) {
	if content == nil {
		return nil, fmt.Errorf("content is required")
	}

	root := content.Content
	if root.Type == "" {
		return nil, fmt.Errorf("content type is required")
	}
	if root.Type != "doc" {
		return nil, fmt.Errorf("content type must be doc")
	}

	parser := &parseState{
		projectID:    projectID,
		documentID:   documentID,
		documentPath: documentPath,
	}
	parser.walk(root, false)
	return parser.items, nil
}

type parseState struct {
	projectID    string
	documentID   string
	documentPath string

	headingStack []string
	items        []*domain.SemanticItem
	order        int
}

func (p *parseState) walk(node service.TipTapNode, suppressParagraph bool) {
	blockType := ""
	text := ""
	nextSuppress := suppressParagraph

	switch node.Type {
	case "heading":
		text = extractText(node)
		level := parseHeadingLevel(node.Attrs)
		if strings.TrimSpace(text) != "" {
			p.updateHeadingPath(level, text)
		}
		blockType = blockTypeHeading
	case "paragraph":
		if suppressParagraph {
			break
		}
		text = extractText(node)
		if strings.TrimSpace(text) == "" {
			text = ""
			break
		}
		blockType = blockTypeParagraph
	case "codeBlock":
		raw := extractText(node)
		lang := getAttrString(node.Attrs, "language")
		prefix := "Code"
		if lang != "" {
			prefix = fmt.Sprintf("Code(%s)", lang)
		}
		text = fmt.Sprintf("%s:\n%s", prefix, raw)
		blockType = blockTypeCode
	case "plantuml":
		source := getAttrString(node.Attrs, "source")
		if source != "" {
			text = source
		} else {
			text = extractText(node)
		}
		blockType = blockTypePlantUML
	case "listItem":
		text = extractText(node)
		if strings.TrimSpace(text) != "" {
			blockType = blockTypeParagraph
		}
		nextSuppress = true
	case "blockquote":
		text = extractText(node)
		if strings.TrimSpace(text) != "" {
			blockType = blockTypeParagraph
		}
		nextSuppress = true
	}

	if blockType != "" {
		p.addItem(node, blockType, text)
	}

	for _, child := range node.Content {
		p.walk(child, nextSuppress)
	}
}

func (p *parseState) updateHeadingPath(level int, text string) {
	if level < 1 {
		level = 1
	}
	if level > len(p.headingStack)+1 {
		level = len(p.headingStack) + 1
	}
	if len(p.headingStack) >= level {
		p.headingStack = p.headingStack[:level-1]
	}
	p.headingStack = append(p.headingStack, text)
}

func (p *parseState) addItem(node service.TipTapNode, blockType, text string) {
	p.order++
	itemID := getAttrString(node.Attrs, "id")
	if itemID == "" {
		itemID = fmt.Sprintf("%s-%d", p.documentID, p.order)
	}

	headingPath := make([]string, len(p.headingStack))
	copy(headingPath, p.headingStack)

	item := &domain.SemanticItem{
		ItemID:       itemID,
		ProjectID:    p.projectID,
		DocumentID:   p.documentID,
		DocumentPath: p.documentPath,
		BlockType:    blockType,
		HeadingPath:  headingPath,
		Text:         text,
		Order:        p.order,
	}
	p.items = append(p.items, item)
}

func extractText(node service.TipTapNode) string {
	var builder strings.Builder
	var walk func(current service.TipTapNode)
	walk = func(current service.TipTapNode) {
		switch current.Type {
		case "text":
			builder.WriteString(current.Text)
			return
		case "hardBreak":
			builder.WriteString("\n")
			return
		}
		for _, child := range current.Content {
			walk(child)
		}
	}
	walk(node)
	return builder.String()
}

func parseHeadingLevel(attrs map[string]interface{}) int {
	if attrs == nil {
		return 1
	}
	value, ok := attrs["level"]
	if !ok {
		return 1
	}
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case int64:
		return int(typed)
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 1
		}
		if parsed, err := strconv.Atoi(trimmed); err == nil {
			return parsed
		}
	}
	return 1
}

func getAttrString(attrs map[string]interface{}, key string) string {
	if attrs == nil {
		return ""
	}
	value, ok := attrs[key]
	if !ok {
		return ""
	}
	strValue, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(strValue)
}
