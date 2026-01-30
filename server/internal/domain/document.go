package domain

import "time"

// Document is the unified data model
type Document struct {
	Meta DocumentMeta `json:"meta"`
	Body DocumentBody `json:"body"`
}

type DocumentMeta struct {
	ID            string                 `json:"id"`
	SchemaVersion string                 `json:"schema_version"` // Default V1
	Title         string                 `json:"title"`
	Slug          string                 `json:"slug"` // System source of truth for filename
	Path          string                 `json:"path"` // Logical slug path: "docs/api/v1"
	ParentID      string                 `json:"parent_id,omitempty"`
	CreatedAt     time.Time              `json:"created_at"`
	UpdatedAt     time.Time              `json:"updated_at"`
	Extra         map[string]interface{} `json:"extra,omitempty"` // Extra fields for extension
}

type DocumentBody struct {
	Type    string      `json:"type"`    // "tiptap" | "markdown"
	Content interface{} `json:"content"` // *TiptapDoc (for tiptap) OR string (for markdown)
}

// TreeItem used for listing and lazy loading
type TreeItem struct {
	ID       string     `json:"id"`
	Slug     string     `json:"slug"`
	Title    string     `json:"title"`
	Kind     string     `json:"kind"` // "file" | "dir"
	Children []TreeItem `json:"children,omitempty"`
}

type HookContext struct {
	ProjectID string
}

type Hooks struct {
	BeforeSave   []func(ctx HookContext, doc *Document) error
	AfterSave    []func(ctx HookContext, doc *Document) error
	BeforeDelete []func(ctx HookContext, docID string) error
	AfterDelete  []func(ctx HookContext, docID string) error
	BeforeMove   []func(ctx HookContext, docID, targetParentID string) error
	AfterMove    []func(ctx HookContext, docID, targetParentID string) error
}
