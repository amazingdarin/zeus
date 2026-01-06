package openapi

import (
	"path/filepath"
	"strings"
)

// DetectOpenAPI performs a lightweight check to identify OpenAPI specs.
// It does not parse the document; it only inspects filename and content.
func DetectOpenAPI(filename string, content []byte) (bool, string) {
	ext := strings.ToLower(strings.TrimSpace(filepath.Ext(filename)))
	if ext != ".yaml" && ext != ".yml" && ext != ".json" {
		return false, ""
	}
	if len(content) == 0 {
		return false, ""
	}

	lower := strings.ToLower(string(content))
	if matchVersionKey(lower, "openapi", "3.") {
		return true, "3.x"
	}
	if matchVersionKey(lower, "swagger", "2.0") {
		return true, "2.0"
	}
	return false, ""
}

func matchVersionKey(content, key, versionPrefix string) bool {
	patterns := []string{
		key + ":",
		`"` + key + `":`,
	}
	for _, pattern := range patterns {
		offset := 0
		for {
			idx := strings.Index(content[offset:], pattern)
			if idx == -1 {
				break
			}
			start := offset + idx + len(pattern)
			tail := strings.TrimSpace(content[start:])
			if strings.HasPrefix(tail, `"`) {
				tail = strings.TrimPrefix(tail, `"`)
			}
			if strings.HasPrefix(tail, versionPrefix) {
				return true
			}
			offset = start
		}
	}
	return false
}
