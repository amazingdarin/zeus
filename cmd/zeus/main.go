package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"time"

	log "github.com/sirupsen/logrus"

	"zeus/internal/api"
	"zeus/internal/config"
	"zeus/internal/repository/objectstorage"
	"zeus/internal/repository/postgres"
	documentsvc "zeus/internal/service/document"
)

type stubDocumentService struct{}

func (s stubDocumentService) UploadDocument(ctx context.Context, req documentsvc.UploadRequest) (*documentsvc.UploadResponse, error) {
	return nil, errors.New("document service not implemented")
}

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

	_, err = objectstorage.NewS3Client(context.Background(), objectstorage.Config{
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

	handler := api.NewDocumentHandler(stubDocumentService{})

	mux := http.NewServeMux()
	mux.HandleFunc("/documents/upload", handler.UploadDocument)

	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("zeus listening on %s", addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server error: %v", err)
	}
}

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
