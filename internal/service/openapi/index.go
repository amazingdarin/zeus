package openapi

import (
	"encoding/json"
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

type Index struct {
	Title     string     `json:"title"`
	Version   string     `json:"version"`
	Tags      []Tag      `json:"tags"`
	Endpoints []Endpoint `json:"endpoints"`
}

type Tag struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type Endpoint struct {
	Path        string   `json:"path"`
	Method      string   `json:"method"`
	Summary     string   `json:"summary"`
	Tags        []string `json:"tags"`
	OperationID string   `json:"operationId"`
}

// ParseIndex parses a raw OpenAPI spec (YAML/JSON) into an index summary.
func ParseIndex(data []byte) (Index, error) {
	spec, err := parseSpec(data)
	if err != nil {
		return Index{}, err
	}
	return buildIndex(spec), nil
}

func parseSpec(data []byte) (map[string]interface{}, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("spec content is empty")
	}
	var spec map[string]interface{}
	if err := json.Unmarshal(data, &spec); err == nil {
		return spec, nil
	}
	var node interface{}
	if err := yaml.Unmarshal(data, &node); err != nil {
		return nil, fmt.Errorf("parse spec: %w", err)
	}
	normalized, ok := normalizeValue(node).(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("spec root is not an object")
	}
	return normalized, nil
}

func normalizeValue(value interface{}) interface{} {
	switch typed := value.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(typed))
		for key, val := range typed {
			out[key] = normalizeValue(val)
		}
		return out
	case map[interface{}]interface{}:
		out := make(map[string]interface{}, len(typed))
		for key, val := range typed {
			out[fmt.Sprint(key)] = normalizeValue(val)
		}
		return out
	case []interface{}:
		out := make([]interface{}, 0, len(typed))
		for _, item := range typed {
			out = append(out, normalizeValue(item))
		}
		return out
	default:
		return typed
	}
}

func buildIndex(spec map[string]interface{}) Index {
	index := Index{}

	info := asMap(spec["info"])
	index.Title = getString(info, "title")
	index.Version = getString(info, "version")

	index.Tags = parseTags(spec["tags"])
	index.Endpoints = parseEndpoints(spec["paths"])

	return index
}

func parseTags(value interface{}) []Tag {
	list := asSlice(value)
	if len(list) == 0 {
		return []Tag{}
	}
	tags := make([]Tag, 0, len(list))
	for _, item := range list {
		obj := asMap(item)
		name := strings.TrimSpace(getString(obj, "name"))
		if name == "" {
			continue
		}
		tags = append(tags, Tag{
			Name:        name,
			Description: getString(obj, "description"),
		})
	}
	return tags
}

func parseEndpoints(value interface{}) []Endpoint {
	paths := asMap(value)
	if len(paths) == 0 {
		return []Endpoint{}
	}
	endpoints := make([]Endpoint, 0)
	for path, rawOps := range paths {
		ops := asMap(rawOps)
		for method, rawOp := range ops {
			method = strings.ToLower(method)
			if !isHTTPMethod(method) {
				continue
			}
			op := asMap(rawOp)
			endpoints = append(endpoints, Endpoint{
				Path:        path,
				Method:      method,
				Summary:     getString(op, "summary"),
				Tags:        getStringSlice(op, "tags"),
				OperationID: getString(op, "operationId"),
			})
		}
	}
	return endpoints
}

func asMap(value interface{}) map[string]interface{} {
	obj, ok := value.(map[string]interface{})
	if !ok || obj == nil {
		return map[string]interface{}{}
	}
	return obj
}

func asSlice(value interface{}) []interface{} {
	list, ok := value.([]interface{})
	if !ok || list == nil {
		return []interface{}{}
	}
	return list
}

func getString(obj map[string]interface{}, key string) string {
	if obj == nil {
		return ""
	}
	val, ok := obj[key]
	if !ok {
		return ""
	}
	switch typed := val.(type) {
	case string:
		return typed
	default:
		return fmt.Sprint(typed)
	}
}

func getStringSlice(obj map[string]interface{}, key string) []string {
	val, ok := obj[key]
	if !ok {
		return []string{}
	}
	list := asSlice(val)
	if len(list) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(list))
	for _, item := range list {
		text := strings.TrimSpace(fmt.Sprint(item))
		if text != "" {
			out = append(out, text)
		}
	}
	return out
}

func isHTTPMethod(method string) bool {
	switch method {
	case "get", "post", "put", "patch", "delete", "options", "head", "trace":
		return true
	default:
		return false
	}
}
