package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"gorm.io/datatypes"
	"gorm.io/gorm"

	"zeus/internal/repository"
)

type KnowledgeEmbeddingRepository struct {
	db *gorm.DB
}

func NewKnowledgeEmbeddingRepository(db *gorm.DB) *KnowledgeEmbeddingRepository {
	return &KnowledgeEmbeddingRepository{db: db}
}

func (r *KnowledgeEmbeddingRepository) UpsertChunks(ctx context.Context, projectKey string, indexName string, chunks []repository.EmbeddingChunk) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("embedding repository not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	indexName = strings.TrimSpace(indexName)
	if projectKey == "" || indexName == "" {
		return fmt.Errorf("project key and index name are required")
	}
	if len(chunks) == 0 {
		return nil
	}

	query := `
INSERT INTO knowledge_embedding_index (
    project_key,
    index_name,
    doc_id,
    block_id,
    chunk_index,
    content,
    model,
    embedding,
    metadata_json,
    updated_at
) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?::vector(768), ?, NOW()
)
ON CONFLICT (project_key, index_name, doc_id, block_id, chunk_index)
DO UPDATE SET
    content = EXCLUDED.content,
    model = EXCLUDED.model,
    embedding = EXCLUDED.embedding,
    metadata_json = EXCLUDED.metadata_json,
    updated_at = NOW();
`

	for _, chunk := range chunks {
		metaJSON, err := encodeEmbeddingMetadata(chunk.Metadata)
		if err != nil {
			return fmt.Errorf("encode metadata: %w", err)
		}
		vectorLiteral := pgvectorLiteral(chunk.Vector)
		if err := r.db.WithContext(ctx).Exec(
			query,
			projectKey,
			indexName,
			chunk.DocID,
			chunk.BlockID,
			chunk.ChunkIndex,
			chunk.Content,
			chunk.Model,
			vectorLiteral,
			metaJSON,
		).Error; err != nil {
			return fmt.Errorf("upsert chunk: %w", err)
		}
	}
	return nil
}

func (r *KnowledgeEmbeddingRepository) DeleteByDoc(ctx context.Context, projectKey string, indexName string, docID string) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("embedding repository not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	indexName = strings.TrimSpace(indexName)
	docID = strings.TrimSpace(docID)
	if projectKey == "" || indexName == "" || docID == "" {
		return fmt.Errorf("project key, index name, and doc id are required")
	}
	return r.db.WithContext(ctx).Exec(
		"DELETE FROM knowledge_embedding_index WHERE project_key = ? AND index_name = ? AND doc_id = ?",
		projectKey,
		indexName,
		docID,
	).Error
}

func (r *KnowledgeEmbeddingRepository) SearchByVector(ctx context.Context, projectKey string, indexName string, vector []float32, limit int, offset int) ([]repository.EmbeddingSearchResult, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("embedding repository not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	indexName = strings.TrimSpace(indexName)
	if projectKey == "" || indexName == "" || len(vector) == 0 {
		return nil, fmt.Errorf("project key, index name, and vector are required")
	}
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	vectorLiteral := pgvectorLiteral(vector)
	query := `
SELECT
    doc_id,
    block_id,
    chunk_index,
    (embedding <-> ?::vector(768)) AS score,
    content,
    metadata_json
FROM knowledge_embedding_index
WHERE project_key = ?
  AND index_name = ?
ORDER BY embedding <-> ?::vector(768)
LIMIT ? OFFSET ?;
`
	rows, err := r.db.WithContext(ctx).Raw(
		query,
		vectorLiteral,
		projectKey,
		indexName,
		vectorLiteral,
		limit,
		offset,
	).Rows()
	if err != nil {
		return nil, fmt.Errorf("search embedding: %w", err)
	}
	defer rows.Close()

	results := make([]repository.EmbeddingSearchResult, 0)
	for rows.Next() {
		var docID string
		var blockID string
		var chunkIndex int
		var score float64
		var content string
		var metadata datatypes.JSON
		if err := rows.Scan(&docID, &blockID, &chunkIndex, &score, &content, &metadata); err != nil {
			return nil, fmt.Errorf("scan embedding result: %w", err)
		}
		results = append(results, repository.EmbeddingSearchResult{
			DocID:      docID,
			BlockID:    blockID,
			ChunkIndex: chunkIndex,
			Score:      score,
			Content:    content,
			Metadata:   decodeEmbeddingMetadata(metadata),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate embedding results: %w", err)
	}
	return results, nil
}

func pgvectorLiteral(vector []float32) string {
	if len(vector) == 0 {
		return "[]"
	}
	parts := make([]string, 0, len(vector))
	for _, value := range vector {
		parts = append(parts, fmt.Sprintf("%f", value))
	}
	return "[" + strings.Join(parts, ",") + "]"
}

func encodeEmbeddingMetadata(value map[string]any) (datatypes.JSON, error) {
	if value == nil {
		return nil, nil
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return datatypes.JSON(payload), nil
}

func decodeEmbeddingMetadata(value datatypes.JSON) map[string]any {
	if len(value) == 0 {
		return nil
	}
	var payload map[string]any
	if err := json.Unmarshal(value, &payload); err != nil {
		return nil
	}
	return payload
}

var _ repository.KnowledgeEmbeddingRepository = (*KnowledgeEmbeddingRepository)(nil)
