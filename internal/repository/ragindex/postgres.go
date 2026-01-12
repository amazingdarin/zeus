package ragindex

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"gorm.io/datatypes"
	"gorm.io/gorm"

	domainrag "zeus/internal/domain/rag"
)

// PostgresIndex stores RAG units in PostgreSQL (derived data).
type PostgresIndex struct {
	db *gorm.DB
}

func NewPostgresIndex(db *gorm.DB) *PostgresIndex {
	return &PostgresIndex{db: db}
}

func (p *PostgresIndex) Upsert(ctx context.Context, items []IndexedUnit) error {
	if p == nil || p.db == nil {
		return fmt.Errorf("postgres index is required")
	}
	if len(items) == 0 {
		return nil
	}
	for _, item := range items {
		unit := item.Unit
		if strings.TrimSpace(unit.UnitID) == "" {
			continue
		}
		path := unit.Path
		if path == nil {
			path = []string{}
		}
		source, err := json.Marshal(unit.Source)
		if err != nil {
			return fmt.Errorf("marshal source: %w", err)
		}
		if err := p.db.WithContext(ctx).Exec(
			`INSERT INTO rag_index_unit
			 (unit_id, project_id, doc_id, path, content, content_hash, source, embedding, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, now(), now())
			 ON CONFLICT (unit_id) DO UPDATE SET
			   project_id = EXCLUDED.project_id,
			   doc_id = EXCLUDED.doc_id,
			   path = EXCLUDED.path,
			   content = EXCLUDED.content,
			   content_hash = EXCLUDED.content_hash,
			   source = EXCLUDED.source,
			   embedding = EXCLUDED.embedding,
			   updated_at = now()`,
			unit.UnitID,
			unit.ProjectID,
			unit.DocID,
			path,
			unit.Content,
			unit.Hash,
			datatypes.JSON(source),
			Vector(item.Vector),
		).Error; err != nil {
			return fmt.Errorf("upsert unit %s: %w", unit.UnitID, err)
		}
	}
	return nil
}

func (p *PostgresIndex) DeleteByProject(ctx context.Context, projectID string) error {
	if p == nil || p.db == nil {
		return fmt.Errorf("postgres index is required")
	}
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return fmt.Errorf("project id is required")
	}
	if err := p.db.WithContext(ctx).
		Exec("DELETE FROM rag_index_unit WHERE project_id = ?", projectID).Error; err != nil {
		return fmt.Errorf("delete project index: %w", err)
	}
	return nil
}

func (p *PostgresIndex) DeleteByDoc(ctx context.Context, projectID, docID string) error {
	if p == nil || p.db == nil {
		return fmt.Errorf("postgres index is required")
	}
	projectID = strings.TrimSpace(projectID)
	docID = strings.TrimSpace(docID)
	if projectID == "" || docID == "" {
		return fmt.Errorf("project id and doc id are required")
	}
	if err := p.db.WithContext(ctx).
		Exec("DELETE FROM rag_index_unit WHERE project_id = ? AND doc_id = ?", projectID, docID).Error; err != nil {
		return fmt.Errorf("delete doc index: %w", err)
	}
	return nil
}

func (p *PostgresIndex) Search(
	ctx context.Context,
	projectID string,
	queryVec []float32,
	topK int,
	filter IndexFilter,
) ([]IndexHit, error) {
	if p == nil || p.db == nil {
		return nil, fmt.Errorf("postgres index is required")
	}
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, fmt.Errorf("project id is required")
	}
	if len(queryVec) == 0 {
		return []IndexHit{}, nil
	}

	var rows []ragIndexRow
	sql := `SELECT unit_id, project_id, doc_id, path, content, content_hash, source,
	          (embedding <-> ?) AS score
	        FROM rag_index_unit
	        WHERE project_id = ?`
	args := []interface{}{Vector(queryVec), projectID}

	if strings.TrimSpace(filter.DocIDPrefix) != "" {
		sql += " AND doc_id LIKE ?"
		args = append(args, strings.TrimSpace(filter.DocIDPrefix)+"%")
	}
	if len(filter.PathPrefix) > 0 {
		sql += " AND path[1:array_length(?::text[], 1)] = ?"
		args = append(args, filter.PathPrefix, filter.PathPrefix)
	}
	sql += " ORDER BY embedding <-> ?"
	args = append(args, Vector(queryVec))
	if topK > 0 {
		sql += " LIMIT ?"
		args = append(args, topK)
	}

	if err := p.db.WithContext(ctx).Raw(sql, args...).Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("search index: %w", err)
	}
	hits := make([]IndexHit, 0, len(rows))
	for _, row := range rows {
		var source domainrag.RAGSourceRef
		if len(row.SourceJSON) > 0 {
			if err := json.Unmarshal(row.SourceJSON, &source); err != nil {
				return nil, fmt.Errorf("parse source: %w", err)
			}
		}
		unit := domainrag.RAGUnit{
			UnitID:    row.UnitID,
			ProjectID: row.ProjectID,
			DocID:     row.DocID,
			Path:      row.Path,
			Content:   row.Content,
			Hash:      row.ContentHash,
			Source:    source,
		}
		hits = append(hits, IndexHit{Unit: unit, Score: row.Score})
	}
	return hits, nil
}

type ragIndexRow struct {
	UnitID      string         `gorm:"column:unit_id"`
	ProjectID   string         `gorm:"column:project_id"`
	DocID       string         `gorm:"column:doc_id"`
	Path        []string       `gorm:"column:path"`
	Content     string         `gorm:"column:content"`
	ContentHash string         `gorm:"column:content_hash"`
	SourceJSON  datatypes.JSON `gorm:"column:source"`
	Score       float64        `gorm:"column:score"`
}

// Vector marshals float32 slices into pgvector textual representation.
type Vector []float32

func (v Vector) Value() (driver.Value, error) {
	if len(v) == 0 {
		return nil, fmt.Errorf("vector is empty")
	}
	parts := make([]string, 0, len(v))
	for _, value := range v {
		parts = append(parts, strconv.FormatFloat(float64(value), 'f', -1, 32))
	}
	return "[" + strings.Join(parts, ",") + "]", nil
}

var _ KnowledgeIndex = (*PostgresIndex)(nil)
