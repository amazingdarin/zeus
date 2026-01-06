package openapi

import "testing"

func TestDetectOpenAPI(t *testing.T) {
	tests := []struct {
		name          string
		filename      string
		content       string
		expectOK      bool
		expectVersion string
	}{
		{
			name:          "yaml openapi3",
			filename:      "spec.yaml",
			content:       "openapi: 3.0.1\ninfo:\n  title: Sample",
			expectOK:      true,
			expectVersion: "3.x",
		},
		{
			name:          "json openapi3",
			filename:      "spec.json",
			content:       "{\"openapi\":\"3.0.0\",\"info\":{}}",
			expectOK:      true,
			expectVersion: "3.x",
		},
		{
			name:          "yaml swagger2",
			filename:      "swagger.yml",
			content:       "swagger: \"2.0\"\ninfo:\n  title: Sample",
			expectOK:      true,
			expectVersion: "2.0",
		},
		{
			name:          "json swagger2",
			filename:      "swagger.json",
			content:       "{\"swagger\":\"2.0\",\"info\":{}}",
			expectOK:      true,
			expectVersion: "2.0",
		},
		{
			name:          "wrong version",
			filename:      "spec.yaml",
			content:       "openapi: 2.0\ninfo:\n  title: Sample",
			expectOK:      false,
			expectVersion: "",
		},
		{
			name:          "unsupported extension",
			filename:      "spec.txt",
			content:       "openapi: 3.0.0",
			expectOK:      false,
			expectVersion: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ok, version := DetectOpenAPI(tt.filename, []byte(tt.content))
			if ok != tt.expectOK {
				t.Fatalf("expected ok=%v, got %v", tt.expectOK, ok)
			}
			if version != tt.expectVersion {
				t.Fatalf("expected version=%q, got %q", tt.expectVersion, version)
			}
		})
	}
}
