package repository

import "context"

type EmbeddingChunk struct {
	DocID      string
	BlockID    string
	ChunkIndex int
	Content    string
	Model      string
	Vector     []float32
	Metadata   map[string]any
}

type EmbeddingSearchResult struct {
	DocID      string
	BlockID    string
	ChunkIndex int
	Score      float64
	Content    string
	Metadata   map[string]any
}

type KnowledgeEmbeddingRepository interface {
	UpsertChunks(ctx context.Context, projectKey string, indexName string, chunks []EmbeddingChunk) error
	DeleteByDoc(ctx context.Context, projectKey string, indexName string, docID string) error
	SearchByVector(ctx context.Context, projectKey string, indexName string, vector []float32, limit int, offset int) ([]EmbeddingSearchResult, error)
}
