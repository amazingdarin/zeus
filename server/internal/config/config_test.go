package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMergesLocalOverrideConfig(t *testing.T) {
	dir := t.TempDir()
	basePath := filepath.Join(dir, "config.yaml")
	localPath := filepath.Join(dir, "config.local.yaml")

	baseConfig := `postgres:
  host: localhost
  port: 30432
  user: zeus
  password: old-password
  database: zeus
`
	localConfig := `postgres:
  port: 5432
  password: new-password
`

	if err := os.WriteFile(basePath, []byte(baseConfig), 0o644); err != nil {
		t.Fatalf("write base config: %v", err)
	}
	if err := os.WriteFile(localPath, []byte(localConfig), 0o644); err != nil {
		t.Fatalf("write local config: %v", err)
	}

	cfg, err := Load(basePath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.Postgres.Port != 5432 {
		t.Fatalf("expected local override port 5432, got %d", cfg.Postgres.Port)
	}
	if cfg.Postgres.Password != "new-password" {
		t.Fatalf("expected local override password, got %q", cfg.Postgres.Password)
	}
	if cfg.Postgres.User != "zeus" {
		t.Fatalf("expected base config user to remain zeus, got %q", cfg.Postgres.User)
	}
}
