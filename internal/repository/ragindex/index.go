package ragindex

import (
	"context"

	domainrag "zeus/internal/domain/rag"
)

type IndexedUnit struct {
	Unit   domainrag.RAGUnit
	Vector []float32
}

type IndexFilter struct {
	DocIDPrefix string
	PathPrefix  []string
}

type IndexHit struct {
	Unit  domainrag.RAGUnit
	Score float64
}

type KnowledgeIndex interface {
	Upsert(ctx context.Context, items []IndexedUnit) error
	DeleteByProject(ctx context.Context, projectID string) error
	DeleteByDoc(ctx context.Context, projectID, docID string) error
	Search(ctx context.Context, projectID string, queryVec []float32, topK int, filter IndexFilter) ([]IndexHit, error)
}
