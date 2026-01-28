package service

import (
	"context"

	"zeus/internal/domain"
)

type IndexKind string

const (
	IndexFulltext  IndexKind = "fulltext"
	IndexEmbedding IndexKind = "embedding"
)

// IndexSpec defines a concrete index within a project.
// Projects may have multiple indexes differentiated by Name/Model/Options.
type IndexSpec struct {
	Kind    IndexKind
	Name    string
	Model   string
	Options map[string]string
}

type IndexBuildRequest struct {
	ProjectKey  string
	Index       IndexSpec
	Docs        []*domain.Document
	FullRebuild bool
}

// KnowledgeIndexService manages document-level indexes.
type KnowledgeIndexService interface {
	Build(ctx context.Context, req IndexBuildRequest) error
	Upsert(ctx context.Context, projectKey string, index IndexSpec, doc *domain.Document) error
	Remove(ctx context.Context, projectKey string, index IndexSpec, docID string) error
}
