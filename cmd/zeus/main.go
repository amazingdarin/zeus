package main

import (
	"context"
	"os"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"

	"zeus/internal/api/handler"
	"zeus/internal/config"
	clients3 "zeus/internal/infra/client/s3"
	ingestions3 "zeus/internal/infra/ingestion/s3"
	"zeus/internal/repository/postgres"
	svcproject "zeus/internal/service/project"
	svcstorageobject "zeus/internal/service/storage_object"
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
	projectRepo := postgres.NewProjectRepository(db)
	projectSvc := svcproject.NewService(projectRepo)

	s3Client, err := clients3.NewS3Client(context.Background(), clients3.Config{
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

	s3Ingestion := ingestions3.NewS3FileIngestion(s3Client, "zeus", "/test")

	storageObjectRepo, err := postgres.NewStorageObjectRepository(db)
	if err != nil {
		log.Fatalf("init storage object repository: %v", err)
	}
	storageObjectSvc, err := svcstorageobject.NewService(s3Ingestion, storageObjectRepo)
	if err != nil {
		log.Fatalf("init storage object service: %v", err)
	}

	router := gin.Default()
	handler.RegisterRoutes(router, storageObjectSvc, nil, projectSvc)

	if err = router.Run(addr); err != nil {
		log.Fatalf("start server: %v", err)
	}
}

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
