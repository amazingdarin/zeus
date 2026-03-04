package postgres

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"gorm.io/gorm"
	"zeus/internal/config"
	codeexecrepo "zeus/internal/modules/codeexec/repository"
	postgresrepo "zeus/internal/repository/postgres"
)

func setupCodeRunRepo(t *testing.T) *CodeRunRepository {
	t.Helper()
	configPath := resolveConfigPath()
	if configPath == "" {
		t.Skip("config.yaml not found")
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
	db := postgresrepo.NewGormDB(postgresrepo.Config{
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
	if err := ensureCodeRunSchema(db); err != nil {
		t.Skipf("ensure code run schema failed: %v", err)
	}
	return NewCodeRunRepository(db)
}

func resolveConfigPath() string {
	if fromEnv := os.Getenv("ZEUS_CONFIG_PATH"); fromEnv != "" {
		return fromEnv
	}
	candidates := []string{
		"config.yaml",
		filepath.Clean("../../../../../config.yaml"),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return ""
}

func ensureCodeRunSchema(db *gorm.DB) error {
	return db.Exec(`CREATE TABLE IF NOT EXISTS document_code_runs (
    id                TEXT PRIMARY KEY,
    run_id            TEXT NOT NULL UNIQUE,
    request_id        TEXT NOT NULL,
    owner_type        TEXT NOT NULL,
    owner_id          TEXT NOT NULL,
    project_key       TEXT NOT NULL,
    doc_id            TEXT NOT NULL,
    block_id          TEXT NOT NULL,
    user_id           TEXT NOT NULL,
    language          TEXT NOT NULL,
    image_ref         TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL,
    stdout            TEXT NOT NULL DEFAULT '',
    stderr            TEXT NOT NULL DEFAULT '',
    truncated         BOOLEAN NOT NULL DEFAULT false,
    timed_out         BOOLEAN NOT NULL DEFAULT false,
    exit_code         INTEGER NOT NULL DEFAULT 0,
    duration_ms       BIGINT NOT NULL DEFAULT 0,
    cpu_limit_milli   INTEGER NOT NULL DEFAULT 0,
    memory_limit_mb   INTEGER NOT NULL DEFAULT 0,
    timeout_ms        INTEGER NOT NULL DEFAULT 0,
    code_sha256       TEXT NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at        TIMESTAMPTZ,
    finished_at       TIMESTAMPTZ
  )`).Error
}

func TestCodeRunRepository_InsertAndFind(t *testing.T) {
	repo := setupCodeRunRepo(t)
	ctx := context.Background()
	runID := "run-" + uuid.NewString()
	requestID := "req-" + uuid.NewString()
	now := time.Now().UTC()
	run := &codeexecrepo.CodeRun{
		RunID:         runID,
		RequestID:     requestID,
		OwnerType:     "personal",
		OwnerID:       "u1",
		ProjectKey:    "p1",
		DocID:         "d1",
		BlockID:       "b1",
		UserID:        "u1",
		Language:      "python",
		ImageRef:      "runner/python@sha256:test",
		Status:        "completed",
		Stdout:        "ok",
		Stderr:        "",
		Truncated:     false,
		TimedOut:      false,
		ExitCode:      0,
		DurationMs:    12,
		CPULimitMilli: 500,
		MemoryLimitMB: 256,
		TimeoutMs:     10000,
		CodeSHA256:    "hash",
		StartedAt:     &now,
		FinishedAt:    &now,
	}

	if err := repo.Insert(ctx, run); err != nil {
		t.Fatalf("insert failed: %v", err)
	}

	found, err := repo.FindByRunID(ctx, runID)
	if err != nil {
		t.Fatalf("find failed: %v", err)
	}
	if found == nil {
		t.Fatalf("expected row, got nil")
	}
	if found.Language != "python" {
		t.Fatalf("expected python, got %s", found.Language)
	}
	if found.DocID != "d1" {
		t.Fatalf("expected d1, got %s", found.DocID)
	}
}
