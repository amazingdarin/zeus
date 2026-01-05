package searchindex

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"

	"zeus/internal/domain"
	"zeus/internal/repository"
)

const DefaultIndexRoot = "/var/lib/zeus/index"

type IndexBuilder struct {
	repo      repository.KnowledgeRepository
	indexRoot string
}

func NewIndexBuilder(repo repository.KnowledgeRepository, indexRoot string) *IndexBuilder {
	indexRoot = strings.TrimSpace(indexRoot)
	if indexRoot == "" {
		indexRoot = DefaultIndexRoot
	}
	return &IndexBuilder{
		repo:      repo,
		indexRoot: indexRoot,
	}
}

func (b *IndexBuilder) Ensure(ctx context.Context, projectKey string) error {
	path, err := b.indexPath(projectKey)
	if err != nil {
		return err
	}
	if !exists(path) {
		return b.Build(ctx, projectKey)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return fmt.Errorf("open index: %w", err)
	}
	defer db.Close()

	var name string
	if err := db.QueryRowContext(
		ctx,
		"SELECT name FROM sqlite_master WHERE type='table' AND name='fts_documents'",
	).Scan(&name); err != nil {
		if err == sql.ErrNoRows {
			return b.Build(ctx, projectKey)
		}
		return fmt.Errorf("check index table: %w", err)
	}
	return nil
}

func (b *IndexBuilder) Build(ctx context.Context, projectKey string) error {
	if b == nil || b.repo == nil {
		return fmt.Errorf("index builder not initialized")
	}
	path, err := b.indexPath(projectKey)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create index dir: %w", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return fmt.Errorf("open index: %w", err)
	}
	defer db.Close()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if _, err := tx.ExecContext(ctx, "DROP TABLE IF EXISTS fts_documents"); err != nil {
		return fmt.Errorf("drop index table: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		CREATE VIRTUAL TABLE fts_documents USING fts5(
			doc_id,
			slug,
			title,
			tags,
			content,
			block_id UNINDEXED
		)`); err != nil {
		return fmt.Errorf("create index table: %w", err)
	}

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO fts_documents(doc_id, slug, title, tags, content, block_id)
		VALUES(?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare insert: %w", err)
	}
	defer stmt.Close()

	metas, err := b.repo.ListDocuments(ctx, projectKey)
	if err != nil {
		return fmt.Errorf("list documents: %w", err)
	}

	for _, meta := range metas {
		docID := strings.TrimSpace(meta.ID)
		if docID == "" {
			continue
		}
		slug := strings.TrimSpace(meta.Slug)
		title := strings.TrimSpace(meta.Title)
		tags := strings.Join(meta.Tags, " ")

		_, content, err := b.repo.ReadDocument(ctx, projectKey, docID)
		if err != nil {
			return fmt.Errorf("read document: %w", err)
		}

		blocks := extractBlocks(content.Content)
		if len(blocks) == 0 {
			if _, err := stmt.ExecContext(ctx, docID, slug, title, tags, "", ""); err != nil {
				return fmt.Errorf("insert doc: %w", err)
			}
			continue
		}

		for _, block := range blocks {
			if strings.TrimSpace(block.Text) == "" {
				continue
			}
			if _, err := stmt.ExecContext(ctx, docID, slug, title, tags, block.Text, block.ID); err != nil {
				return fmt.Errorf("insert doc block: %w", err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit index: %w", err)
	}
	return nil
}

func (b *IndexBuilder) Search(
	ctx context.Context,
	projectKey string,
	query string,
) ([]domain.SearchResult, error) {
	path, err := b.indexPath(projectKey)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open index: %w", err)
	}
	defer db.Close()

	rows, err := db.QueryContext(ctx, `
		SELECT doc_id, slug, title,
			snippet(fts_documents, 4, '<b>', '</b>', '...', 10) AS snippet,
			block_id
		FROM fts_documents
		WHERE fts_documents MATCH ?
		ORDER BY bm25(fts_documents)
	`, query)
	if err != nil {
		return nil, fmt.Errorf("search index: %w", err)
	}
	defer rows.Close()

	results := make([]domain.SearchResult, 0)
	for rows.Next() {
		var item domain.SearchResult
		if err := rows.Scan(&item.DocID, &item.Slug, &item.Title, &item.Snippet, &item.BlockID); err != nil {
			return nil, fmt.Errorf("scan result: %w", err)
		}
		results = append(results, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate results: %w", err)
	}
	return results, nil
}

func (b *IndexBuilder) indexPath(projectKey string) (string, error) {
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return "", fmt.Errorf("project key is required")
	}
	return filepath.Join(b.indexRoot, projectKey, "fts.sqlite"), nil
}

type blockText struct {
	ID   string
	Text string
}

func extractBlocks(content map[string]interface{}) []blockText {
	if content == nil {
		return nil
	}
	blocks := make([]blockText, 0)
	walkNode(content, &blocks)
	return blocks
}

func walkNode(node map[string]interface{}, blocks *[]blockText) {
	if node == nil {
		return
	}
	nodeType := asString(node["type"])
	if isBlockNode(nodeType) {
		text := strings.TrimSpace(collectText(node))
		if text != "" {
			*blocks = append(*blocks, blockText{
				ID:   nodeAttrID(node),
				Text: text,
			})
		}
		return
	}

	for _, child := range nodeChildren(node) {
		if childMap, ok := child.(map[string]interface{}); ok {
			walkNode(childMap, blocks)
		}
	}
}

func isBlockNode(nodeType string) bool {
	switch nodeType {
	case "paragraph", "heading", "codeBlock", "blockquote", "listItem", "plantuml":
		return true
	default:
		return false
	}
}

func nodeAttrID(node map[string]interface{}) string {
	attrs, ok := node["attrs"].(map[string]interface{})
	if !ok {
		return ""
	}
	id, _ := attrs["id"].(string)
	return strings.TrimSpace(id)
}

func collectText(node map[string]interface{}) string {
	var builder strings.Builder
	collectTextInto(node, &builder)
	return builder.String()
}

func collectTextInto(node map[string]interface{}, builder *strings.Builder) {
	if node == nil {
		return
	}
	nodeType := asString(node["type"])
	if nodeType == "text" {
		builder.WriteString(asString(node["text"]))
	}
	if nodeType == "hardBreak" {
		builder.WriteByte('\n')
	}
	for _, child := range nodeChildren(node) {
		if childMap, ok := child.(map[string]interface{}); ok {
			collectTextInto(childMap, builder)
		}
	}
}

func nodeChildren(node map[string]interface{}) []interface{} {
	children, ok := node["content"].([]interface{})
	if !ok {
		return nil
	}
	return children
}

func asString(value interface{}) string {
	text, _ := value.(string)
	return text
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
