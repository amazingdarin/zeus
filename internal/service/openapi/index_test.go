package openapi

import "testing"

func TestParseIndexOpenAPI3(t *testing.T) {
	spec := []byte(`
openapi: 3.0.1
info:
  title: Sample API
  version: "1.2.3"
tags:
  - name: user
    description: User operations
paths:
  /users:
    get:
      summary: List users
      tags: [user]
      operationId: listUsers
`)
	index, err := ParseIndex(spec)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if index.Title != "Sample API" {
		t.Fatalf("expected title, got %q", index.Title)
	}
	if index.Version != "1.2.3" {
		t.Fatalf("expected version, got %q", index.Version)
	}
	if len(index.Tags) != 1 || index.Tags[0].Name != "user" {
		t.Fatalf("expected user tag")
	}
	if len(index.Endpoints) != 1 {
		t.Fatalf("expected 1 endpoint")
	}
	endpoint := index.Endpoints[0]
	if endpoint.Path != "/users" || endpoint.Method != "get" {
		t.Fatalf("unexpected endpoint: %+v", endpoint)
	}
}

func TestParseIndexSwagger2(t *testing.T) {
	spec := []byte(`{
  "swagger": "2.0",
  "info": {"title": "Swagger API", "version": "2.0.0"},
  "paths": {
    "/items": {
      "post": {
        "summary": "Create item",
        "operationId": "createItem",
        "tags": ["items"]
      }
    }
  }
}`)
	index, err := ParseIndex(spec)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if index.Title != "Swagger API" {
		t.Fatalf("expected title, got %q", index.Title)
	}
	if len(index.Endpoints) != 1 {
		t.Fatalf("expected 1 endpoint")
	}
	endpoint := index.Endpoints[0]
	if endpoint.Method != "post" || endpoint.Path != "/items" {
		t.Fatalf("unexpected endpoint: %+v", endpoint)
	}
}
