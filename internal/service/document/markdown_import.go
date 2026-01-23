package document

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/text"
)

type tiptapNode map[string]interface{}
type tiptapMark map[string]interface{}

var fenceAttrPattern = regexp.MustCompile(`([a-zA-Z0-9_-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s}]+)`) //nolint:lll

// ConvertMarkdownToTiptapJSON converts markdown into a tiptap JSON payload.
// The returned map includes {meta, content} matching frontend exportContentJson.
func ConvertMarkdownToTiptapJSON(markdown string) (map[string]interface{}, error) {
	source := []byte(markdown)
	parser := goldmark.New(
		goldmark.WithExtensions(extension.GFM, extension.Strikethrough),
	)

	root := parser.Parser().Parse(text.NewReader(source))
	content := convertBlocks(root, source)
	if len(content) == 0 {
		content = append(content, tiptapNode{"type": "paragraph"})
	}

	now := time.Now().UTC().Format(time.RFC3339)
	return map[string]interface{}{
		"meta": map[string]interface{}{
			"zeus":           true,
			"format":         "tiptap",
			"schema_version": 1,
			"editor":         "tiptap",
			"created_at":     now,
			"updated_at":     now,
		},
		"content": map[string]interface{}{
			"type":    "doc",
			"content": content,
		},
	}, nil
}

func convertBlocks(node ast.Node, source []byte) []tiptapNode {
	out := make([]tiptapNode, 0)
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		if converted := convertBlock(child, source); converted != nil {
			out = append(out, converted...)
		}
	}
	return out
}

func convertBlock(node ast.Node, source []byte) []tiptapNode {
	switch n := node.(type) {
	case *ast.Heading:
		content := convertInlineChildren(node, source, nil)
		return []tiptapNode{
			{
				"type": "heading",
				"attrs": map[string]interface{}{
					"level": n.Level,
				},
				"content": content,
			},
		}
	case *ast.Paragraph:
		content := convertInlineChildren(node, source, nil)
		return []tiptapNode{
			{
				"type":    "paragraph",
				"content": content,
			},
		}
	case *ast.FencedCodeBlock:
		info := ""
		if n.Info != nil {
			info = string(n.Info.Segment.Value(source))
		}
		language, attrs := parseFenceInfo(info)
		code := string(n.Lines().Value(source))
		if language == "file" {
			return []tiptapNode{
				{
					"type":  "file_block",
					"attrs": buildFileBlockAttrs(attrs),
				},
			}
		}
		return []tiptapNode{
			{
				"type":    "codeBlock",
				"attrs":   buildCodeBlockAttrs(language, attrs),
				"content": []tiptapNode{textNode(code, nil)},
			},
		}
	case *ast.CodeBlock:
		code := string(n.Lines().Value(source))
		return []tiptapNode{
			{
				"type":    "codeBlock",
				"content": []tiptapNode{textNode(code, nil)},
			},
		}
	case *ast.Blockquote:
		content := convertBlocks(node, source)
		return []tiptapNode{
			{
				"type":    "blockquote",
				"content": content,
			},
		}
	case *ast.List:
		items := make([]tiptapNode, 0)
		for child := node.FirstChild(); child != nil; child = child.NextSibling() {
			if itemNodes := convertBlock(child, source); itemNodes != nil {
				items = append(items, itemNodes...)
			}
		}
		attrs := map[string]interface{}{}
		nodeType := "bulletList"
		if n.IsOrdered() {
			nodeType = "orderedList"
			if n.Start > 0 {
				attrs["order"] = n.Start
			}
		}
		payload := tiptapNode{"type": nodeType, "content": items}
		if len(attrs) > 0 {
			payload["attrs"] = attrs
		}
		return []tiptapNode{payload}
	case *ast.ListItem:
		content := convertBlocks(node, source)
		return []tiptapNode{
			{
				"type":    "listItem",
				"content": content,
			},
		}
	case *ast.ThematicBreak:
		return []tiptapNode{{"type": "horizontalRule"}}
	default:
		// Unknown blocks: fall back to children
		return convertBlocks(node, source)
	}
}

func convertInlineChildren(node ast.Node, source []byte, marks []tiptapMark) []tiptapNode {
	out := make([]tiptapNode, 0)
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		out = append(out, convertInline(child, source, marks)...)
	}
	return out
}

func convertInline(node ast.Node, source []byte, marks []tiptapMark) []tiptapNode {
	switch n := node.(type) {
	case *ast.Text:
		text := string(n.Value(source))
		nodes := make([]tiptapNode, 0)
		if text != "" {
			nodes = append(nodes, textNode(text, marks))
		}
		if n.HardLineBreak() {
			nodes = append(nodes, tiptapNode{"type": "hardBreak"})
		} else if n.SoftLineBreak() {
			nodes = append(nodes, textNode(" ", marks))
		}
		return nodes
	case *ast.String:
		if len(n.Value) == 0 {
			return nil
		}
		return []tiptapNode{textNode(string(n.Value), marks)}
	case *ast.Emphasis:
		markType := "italic"
		if n.Level >= 2 {
			markType = "bold"
		}
		nextMarks := appendMark(marks, tiptapMark{"type": markType})
		return convertInlineChildren(node, source, nextMarks)
	case *ast.CodeSpan:
		codeText := extractInlineText(node, source)
		if codeText == "" {
			return nil
		}
		nextMarks := appendMark(marks, tiptapMark{"type": "code"})
		return []tiptapNode{textNode(codeText, nextMarks)}
	case *ast.Link:
		href := strings.TrimSpace(string(n.Destination))
		attrs := map[string]interface{}{"href": href}
		title := strings.TrimSpace(string(n.Title))
		if title != "" {
			attrs["title"] = title
		}
		nextMarks := appendMark(marks, tiptapMark{"type": "link", "attrs": attrs})
		return convertInlineChildren(node, source, nextMarks)
	case *ast.AutoLink:
		href := string(n.URL(source))
		attrs := map[string]interface{}{"href": href}
		nextMarks := appendMark(marks, tiptapMark{"type": "link", "attrs": attrs})
		label := string(n.Label(source))
		if label == "" {
			label = href
		}
		return []tiptapNode{textNode(label, nextMarks)}
	case *ast.Image:
		alt := extractInlineText(node, source)
		attrs := map[string]interface{}{"src": string(n.Destination)}
		if title := strings.TrimSpace(string(n.Title)); title != "" {
			attrs["title"] = title
		}
		if alt != "" {
			attrs["alt"] = alt
		}
		return []tiptapNode{{"type": "image", "attrs": attrs}}
	default:
		return convertInlineChildren(node, source, marks)
	}
}

func textNode(text string, marks []tiptapMark) tiptapNode {
	node := tiptapNode{"type": "text", "text": text}
	if len(marks) > 0 {
		nodeMarks := make([]tiptapMark, len(marks))
		copy(nodeMarks, marks)
		node["marks"] = nodeMarks
	}
	return node
}

func appendMark(marks []tiptapMark, mark tiptapMark) []tiptapMark {
	next := make([]tiptapMark, 0, len(marks)+1)
	next = append(next, marks...)
	next = append(next, mark)
	return next
}

func extractInlineText(node ast.Node, source []byte) string {
	var builder strings.Builder
	for child := node.FirstChild(); child != nil; child = child.NextSibling() {
		switch c := child.(type) {
		case *ast.Text:
			builder.Write(c.Value(source))
		case *ast.String:
			builder.Write(c.Value)
		default:
			builder.WriteString(extractInlineText(child, source))
		}
	}
	return builder.String()
}

func parseFenceInfo(info string) (string, map[string]interface{}) {
	trimmed := strings.TrimSpace(info)
	if trimmed == "" {
		return "", map[string]interface{}{}
	}
	language := trimmed
	attrsText := ""
	if idx := strings.Index(trimmed, "{"); idx >= 0 {
		language = strings.TrimSpace(trimmed[:idx])
		attrsText = strings.TrimSpace(strings.TrimSuffix(trimmed[idx:], "}"))
		attrsText = strings.TrimPrefix(attrsText, "{")
	}
	attrs := parseFenceAttrs(attrsText)
	return language, attrs
}

func parseFenceAttrs(input string) map[string]interface{} {
	attrs := map[string]interface{}{}
	if strings.TrimSpace(input) == "" {
		return attrs
	}
	for _, match := range fenceAttrPattern.FindAllStringSubmatch(input, -1) {
		if len(match) < 3 {
			continue
		}
		key := match[1]
		raw := strings.TrimSpace(match[2])
		value := strings.Trim(raw, "\"'")
		if value == "true" || value == "false" {
			attrs[key] = value == "true"
			continue
		}
		if num, err := strconv.Atoi(value); err == nil {
			attrs[key] = num
			continue
		}
		attrs[key] = value
	}
	return attrs
}

func buildCodeBlockAttrs(language string, attrs map[string]interface{}) map[string]interface{} {
	result := map[string]interface{}{}
	if language != "" {
		result["language"] = language
	}
	if renderer, ok := attrs["renderer"].(string); ok && renderer != "" {
		result["renderer"] = renderer
	}
	if viewMode, ok := attrs["view"].(string); ok && viewMode != "" {
		result["view_mode"] = viewMode
		result["preview"] = viewMode != "text"
	}
	if collapsed, ok := attrs["collapsed"].(bool); ok {
		result["collapsed"] = collapsed
	}
	if preview, ok := attrs["preview"].(bool); ok {
		result["preview"] = preview
	}
	return result
}

func buildFileBlockAttrs(attrs map[string]interface{}) map[string]interface{} {
	result := map[string]interface{}{}
	if value, ok := attrs["asset_id"].(string); ok {
		result["asset_id"] = value
	}
	if value, ok := attrs["file_name"].(string); ok {
		result["file_name"] = value
	}
	if value, ok := attrs["mime"].(string); ok {
		result["mime"] = value
	}
	if value, ok := attrs["file_type"].(string); ok {
		result["file_type"] = value
	}
	if value, ok := attrs["office_type"].(string); ok {
		result["office_type"] = value
	}
	if value, ok := attrs["size"].(int); ok {
		result["size"] = value
	}
	if value, ok := attrs["size"].(int64); ok {
		result["size"] = value
	}
	return result
}

func NormalizeImportTitle(filename string) string {
	trimmed := strings.TrimSpace(filename)
	if trimmed == "" {
		return "Untitled Document"
	}
	ext := pathExt(trimmed)
	if ext != "" {
		trimmed = strings.TrimSuffix(trimmed, ext)
	}
	if trimmed == "" {
		return "Untitled Document"
	}
	return trimmed
}

func pathExt(name string) string {
	idx := strings.LastIndex(name, ".")
	if idx <= 0 || idx == len(name)-1 {
		return ""
	}
	return name[idx:]
}

func ResolveSourceType(filename, explicit string) (string, error) {
	candidate := strings.TrimSpace(strings.ToLower(explicit))
	if candidate != "" {
		return candidate, nil
	}
	lower := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(lower, ".md"), strings.HasSuffix(lower, ".markdown"):
		return "markdown", nil
	default:
		return "", fmt.Errorf("unsupported source type")
	}
}
