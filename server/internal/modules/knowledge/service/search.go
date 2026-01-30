package service

import "context"

type SearchMode string

const (
	SearchFulltext  SearchMode = "fulltext"
	SearchEmbedding SearchMode = "embedding"
	SearchHybrid    SearchMode = "hybrid"
)

type SearchQuery struct {
	Mode          SearchMode
	Text          string
	Vector        []float32
	Filters       map[string]string
	Limit         int
	Offset        int
	SortBy        string
	Highlight     bool
	Fuzzy         bool
	MinSimilarity float64
}

type SearchResult struct {
	DocID    string
	Score    float64
	Snippet  string
	Metadata map[string]string
}

// KnowledgeSearchService executes document-level queries against an index.
type KnowledgeSearchService interface {
	Search(ctx context.Context, projectKey string, index IndexSpec, query SearchQuery) ([]SearchResult, error)
}
