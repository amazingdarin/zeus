package postgres

import (
	"context"
	"os"
	"strings"
	"testing"

	"zeus/internal/config"
	"zeus/internal/repository"

	"gorm.io/gorm"
)

type fulltextTestCaps struct {
	zhparser bool
	trgm     bool
}

func setupFulltextRepo(t *testing.T) (*KnowledgeFulltextRepository, fulltextTestCaps) {
	t.Helper()
	configPath := os.Getenv("ZEUS_CONFIG_PATH")
	if configPath == "" {
		configPath = "config.yaml"
	}
	cfg, err := config.Load(configPath)
	if err != nil {
		t.Skipf("load config failed: %v", err)
	}
	config.AppConfig = cfg
	connMaxLifetime, err := cfg.Postgres.ConnMaxLifetimeDuration()
	if err != nil {
		t.Skipf("parse conn_max_lifetime: %v", err)
	}
	db := NewGormDB(Config{
		Host:            cfg.Postgres.Host,
		Port:            cfg.Postgres.Port,
		User:            cfg.Postgres.User,
		Password:        cfg.Postgres.Password,
		Database:        cfg.Postgres.Database,
		SSLMode:         cfg.Postgres.SSLMode,
		TimeZone:        cfg.Postgres.TimeZone,
		MaxOpenConns:    cfg.Postgres.MaxOpenConns,
		MaxIdleConns:    cfg.Postgres.MaxIdleConns,
		ConnMaxLifetime: connMaxLifetime,
	})
	if db == nil {
		t.Skip("init db returned nil")
	}
	capabilities, err := ensureFulltextSchema(db)
	if err != nil {
		t.Skipf("ensure fulltext schema failed: %v", err)
	}
	if !capabilities.zhparser {
		t.Skip("zhparser text search configuration not available")
	}
	return NewKnowledgeFulltextRepository(db), capabilities
}

func ensureFulltextSchema(db *gorm.DB) (fulltextTestCaps, error) {
	caps := fulltextTestCaps{}
	if db == nil {
		return caps, nil
	}
	zhAvailable, err := extensionAvailable(db, "zhparser")
	if err != nil {
		return caps, err
	}
	if zhAvailable {
		if err := db.Exec("CREATE EXTENSION IF NOT EXISTS zhparser;").Error; err != nil {
			if !isExtensionUnavailable(err) {
				return caps, err
			}
		} else {
			caps.zhparser = true
		}
	}

	trgmAvailable, err := extensionAvailable(db, "pg_trgm")
	if err != nil {
		return caps, err
	}
	if trgmAvailable {
		if err := db.Exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;").Error; err != nil {
			if !isExtensionUnavailable(err) {
				return caps, err
			}
		} else {
			caps.trgm = true
		}
	}
	if err := db.Exec("CREATE TABLE IF NOT EXISTS knowledge_fulltext_index (" +
		"project_key TEXT NOT NULL," +
		"index_name TEXT NOT NULL," +
		"doc_id TEXT NOT NULL," +
		"title TEXT NOT NULL DEFAULT ''," +
		"content_plain TEXT NOT NULL DEFAULT ''," +
		"tsv_en tsvector NOT NULL," +
		"tsv_zh tsvector NOT NULL," +
		"updated_at TIMESTAMPTZ NOT NULL DEFAULT now()," +
		"metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb," +
		"PRIMARY KEY (project_key, index_name, doc_id)" +
		")").Error; err != nil {
		return caps, err
	}
	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_kft_en ON knowledge_fulltext_index USING GIN(tsv_en);").Error; err != nil {
		return caps, err
	}
	if err := db.Exec("CREATE INDEX IF NOT EXISTS idx_kft_zh ON knowledge_fulltext_index USING GIN(tsv_zh);").Error; err != nil {
		return caps, err
	}
	return caps, nil
}

func extensionAvailable(db *gorm.DB, name string) (bool, error) {
	var count int
	if err := db.Raw("SELECT count(1) FROM pg_available_extensions WHERE name = ?", name).Scan(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func isExtensionUnavailable(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "extension") &&
		strings.Contains(strings.ToLower(err.Error()), "is not available")
}

func TestKnowledgeFulltextRepository_SearchEnglish(t *testing.T) {
	repo, _ := setupFulltextRepo(t)
	ctx := context.Background()
	projectKey := "test-project"
	indexName := "default"
	_ = repo.DeleteByIndex(ctx, projectKey, indexName)
	if err := repo.Upsert(ctx, projectKey, indexName, "doc-1", "Hello World", "Hello World body", nil); err != nil {
		t.Fatalf("upsert failed: %v", err)
	}
	if err := repo.Upsert(ctx, projectKey, indexName, "doc-2", "Another", "Different content", nil); err != nil {
		t.Fatalf("upsert failed: %v", err)
	}

	results, err := repo.Search(ctx, projectKey, indexName, repository.FulltextEnglish, "hello", nil, 10, 0, true, "relevance")
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if len(results) == 0 {
		t.Fatalf("expected search results")
	}
	if results[0].DocID != "doc-1" {
		t.Fatalf("expected doc-1, got %s", results[0].DocID)
	}
}

func TestKnowledgeFulltextRepository_SearchChinese(t *testing.T) {
	repo, _ := setupFulltextRepo(t)
	ctx := context.Background()
	projectKey := "test-project"
	indexName := "default"
	_ = repo.DeleteByIndex(ctx, projectKey, indexName)
	if err := repo.Upsert(ctx, projectKey, indexName, "doc-zh", "文档功能", "说明 代码块", nil); err != nil {
		t.Fatalf("upsert failed: %v", err)
	}

	results, err := repo.Search(ctx, projectKey, indexName, repository.FulltextChinese, "文档", nil, 10, 0, true, "relevance")
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if len(results) == 0 {
		t.Fatalf("expected search results")
	}
	if results[0].DocID != "doc-zh" {
		t.Fatalf("expected doc-zh, got %s", results[0].DocID)
	}
}

func TestKnowledgeFulltextRepository_FuzzySearch(t *testing.T) {
	repo, caps := setupFulltextRepo(t)
	if !caps.trgm {
		t.Skip("pg_trgm extension not available")
	}
	ctx := context.Background()
	projectKey := "test-project"
	indexName := "default"
	_ = repo.DeleteByIndex(ctx, projectKey, indexName)
	if err := repo.Upsert(ctx, projectKey, indexName, "doc-fz", "Hello World", "Hello World body", nil); err != nil {
		t.Fatalf("upsert failed: %v", err)
	}

	results, err := repo.FuzzySearch(ctx, projectKey, indexName, "Helo Worl", 0.2, 10, 0)
	if err != nil {
		t.Fatalf("fuzzy search failed: %v", err)
	}
	if len(results) == 0 {
		t.Fatalf("expected fuzzy search results")
	}
	if results[0].DocID != "doc-fz" {
		t.Fatalf("expected doc-fz, got %s", results[0].DocID)
	}
}
