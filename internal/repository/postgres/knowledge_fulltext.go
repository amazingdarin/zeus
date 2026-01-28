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

type KnowledgeFulltextRepository struct {
	db *gorm.DB
}

func NewKnowledgeFulltextRepository(db *gorm.DB) *KnowledgeFulltextRepository {
	return &KnowledgeFulltextRepository{db: db}
}

func (r *KnowledgeFulltextRepository) Upsert(
	ctx context.Context,
	projectKey string,
	indexName string,
	docID string,
	title string,
	contentPlain string,
	metadata map[string]any,
) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("fulltext repository not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	indexName = strings.TrimSpace(indexName)
	docID = strings.TrimSpace(docID)
	if projectKey == "" || indexName == "" || docID == "" {
		return fmt.Errorf("project key, index name, and doc id are required")
	}

	metaJSON, err := encodeMetadataJSON(metadata)
	if err != nil {
		return fmt.Errorf("encode metadata: %w", err)
	}

	query := `
INSERT INTO knowledge_fulltext_index (
    project_key,
    index_name,
    doc_id,
    title,
    content_plain,
    tsv_en,
    tsv_zh,
    updated_at,
    metadata_json
) VALUES (
    ?, ?, ?,
    ?, ?,
    setweight(to_tsvector('english', ?), 'A') || setweight(to_tsvector('english', ?), 'B'),
    setweight(to_tsvector('zhparser', ?), 'A') || setweight(to_tsvector('zhparser', ?), 'B'),
    NOW(), ?
) ON CONFLICT (project_key, index_name, doc_id)
DO UPDATE SET
    title = EXCLUDED.title,
    content_plain = EXCLUDED.content_plain,
    tsv_en = EXCLUDED.tsv_en,
    tsv_zh = EXCLUDED.tsv_zh,
    updated_at = NOW(),
    metadata_json = EXCLUDED.metadata_json;
`

	return r.db.WithContext(ctx).Exec(
		query,
		projectKey,
		indexName,
		docID,
		title,
		contentPlain,
		title,
		contentPlain,
		title,
		contentPlain,
		metaJSON,
	).Error
}

func (r *KnowledgeFulltextRepository) Delete(ctx context.Context, projectKey string, indexName string, docID string) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("fulltext repository not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	indexName = strings.TrimSpace(indexName)
	docID = strings.TrimSpace(docID)
	if projectKey == "" || indexName == "" || docID == "" {
		return fmt.Errorf("project key, index name, and doc id are required")
	}
	return r.db.WithContext(ctx).
		Exec(
			"DELETE FROM knowledge_fulltext_index WHERE project_key = ? AND index_name = ? AND doc_id = ?",
			projectKey,
			indexName,
			docID,
		).Error
}

func (r *KnowledgeFulltextRepository) DeleteByIndex(ctx context.Context, projectKey string, indexName string) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("fulltext repository not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	indexName = strings.TrimSpace(indexName)
	if projectKey == "" || indexName == "" {
		return fmt.Errorf("project key and index name are required")
	}
	return r.db.WithContext(ctx).
		Exec(
			"DELETE FROM knowledge_fulltext_index WHERE project_key = ? AND index_name = ?",
			projectKey,
			indexName,
		).Error
}

func (r *KnowledgeFulltextRepository) Search(
	ctx context.Context,
	projectKey string,
	indexName string,
	language repository.FulltextLanguage,
	queryText string,
	filters map[string]string,
	limit int,
	offset int,
	highlight bool,
	sortBy string,
) ([]repository.FulltextSearchResult, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("fulltext repository not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	indexName = strings.TrimSpace(indexName)
	queryText = strings.TrimSpace(queryText)
	if projectKey == "" || indexName == "" || queryText == "" {
		return nil, fmt.Errorf("project key, index name, and query text are required")
	}
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	cfg := "english"
	tsv := "tsv_en"
	if language == repository.FulltextChinese {
		cfg = "zhparser"
		tsv = "tsv_zh"
	}

	snippetExpr := "content_plain"
	if highlight {
		snippetExpr = fmt.Sprintf("ts_headline('%s', content_plain, q.query)", cfg)
	}

	orderBy := "score DESC"
	if strings.EqualFold(sortBy, "updated_at") {
		orderBy = "updated_at DESC"
	}

	whereFilters := ""
	args := []any{queryText, projectKey, indexName}
	for key, value := range filters {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" || value == "" {
			continue
		}
		whereFilters += " AND metadata_json ->> ? = ?"
		args = append(args, key, value)
	}
	args = append(args, limit, offset)

	sql := fmt.Sprintf(`
WITH q AS (
    SELECT to_tsquery('%s', ?) AS query
)
SELECT
    doc_id AS doc_id,
    ts_rank(%s, q.query) AS score,
    %s AS snippet,
    metadata_json AS metadata
FROM knowledge_fulltext_index, q
WHERE project_key = ?
  AND index_name = ?
  AND %s @@ q.query%s
ORDER BY %s
LIMIT ? OFFSET ?;
`, cfg, tsv, snippetExpr, tsv, whereFilters, orderBy)

	rows, err := r.db.WithContext(ctx).Raw(sql, args...).Rows()
	if err != nil {
		return nil, fmt.Errorf("search fulltext: %w", err)
	}
	defer rows.Close()

	results := make([]repository.FulltextSearchResult, 0)
	for rows.Next() {
		var docID string
		var score float64
		var snippet string
		var metadata datatypes.JSON
		if err := rows.Scan(&docID, &score, &snippet, &metadata); err != nil {
			return nil, fmt.Errorf("scan fulltext result: %w", err)
		}
		results = append(results, repository.FulltextSearchResult{
			DocID:    docID,
			Score:    score,
			Snippet:  snippet,
			Metadata: decodeMetadataJSON(metadata),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate fulltext results: %w", err)
	}
	return results, nil
}

func (r *KnowledgeFulltextRepository) FuzzySearch(
	ctx context.Context,
	projectKey string,
	indexName string,
	queryText string,
	minSimilarity float64,
	limit int,
	offset int,
) ([]repository.FulltextSearchResult, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("fulltext repository not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	indexName = strings.TrimSpace(indexName)
	queryText = strings.TrimSpace(queryText)
	if projectKey == "" || indexName == "" || queryText == "" {
		return nil, fmt.Errorf("project key, index name, and query text are required")
	}
	if minSimilarity <= 0 {
		minSimilarity = 0.2
	}
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	sql := `
SELECT
    doc_id AS doc_id,
    similarity(content_plain, ?) AS score,
    content_plain AS snippet,
    metadata_json AS metadata
FROM knowledge_fulltext_index
WHERE project_key = ?
  AND index_name = ?
  AND similarity(content_plain, ?) >= ?
ORDER BY score DESC
LIMIT ? OFFSET ?;
`
	rows, err := r.db.WithContext(ctx).Raw(
		sql,
		queryText,
		projectKey,
		indexName,
		queryText,
		minSimilarity,
		limit,
		offset,
	).Rows()
	if err != nil {
		return nil, fmt.Errorf("fuzzy search fulltext: %w", err)
	}
	defer rows.Close()

	results := make([]repository.FulltextSearchResult, 0)
	for rows.Next() {
		var docID string
		var score float64
		var snippet string
		var metadata datatypes.JSON
		if err := rows.Scan(&docID, &score, &snippet, &metadata); err != nil {
			return nil, fmt.Errorf("scan fuzzy result: %w", err)
		}
		results = append(results, repository.FulltextSearchResult{
			DocID:    docID,
			Score:    score,
			Snippet:  snippet,
			Metadata: decodeMetadataJSON(metadata),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate fuzzy results: %w", err)
	}
	return results, nil
}

func encodeMetadataJSON(value map[string]any) (datatypes.JSON, error) {
	if value == nil {
		return nil, nil
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return datatypes.JSON(payload), nil
}

func decodeMetadataJSON(value datatypes.JSON) map[string]any {
	if len(value) == 0 {
		return nil
	}
	var payload map[string]any
	if err := json.Unmarshal(value, &payload); err != nil {
		return nil
	}
	return payload
}

var _ repository.KnowledgeFulltextRepository = (*KnowledgeFulltextRepository)(nil)
