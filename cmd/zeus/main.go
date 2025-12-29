package main

import (
	"context"
	"os"

	log "github.com/sirupsen/logrus"

	"zeus/internal/config"
	"zeus/internal/infra/s3"
	"zeus/internal/repository/postgres"
)

func main() {
	configPath := getenv("ZEUS_CONFIG_PATH", "config.yaml")

	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	addr := cfg.Server.Addr
	if addr == "" {
		log.Fatal("server addr is required")
	}
	connMaxLifetime, err := cfg.Postgres.ConnMaxLifetimeDuration()
	if err != nil {
		log.Fatalf("parse conn_max_lifetime: %v", err)
	}
	db, err := postgres.NewGormDB(postgres.Config{
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
	if err != nil {
		log.Fatalf("init postgres: %v", err)
	}
	_ = db

	_, err = s3.NewS3Client(context.Background(), s3.Config{
		Endpoint:     cfg.ObjectStorage.Endpoint,
		Region:       cfg.ObjectStorage.Region,
		AccessKey:    cfg.ObjectStorage.AccessKey,
		SecretKey:    cfg.ObjectStorage.SecretKey,
		UsePathStyle: cfg.ObjectStorage.UsePathStyle,
		Insecure:     cfg.ObjectStorage.Insecure,
	})
	if err != nil {
		log.Fatalf("init object storage: %v", err)
	}
}

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
