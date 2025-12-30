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
	config.AppConfig = cfg
	addr := config.AppConfig.Server.Addr
	if addr == "" {
		log.Fatal("server addr is required")
	}
	connMaxLifetime, err := config.AppConfig.Postgres.ConnMaxLifetimeDuration()
	if err != nil {
		log.Fatalf("parse conn_max_lifetime: %v", err)
	}
	db, err := postgres.NewGormDB(postgres.Config{
		Host:            config.AppConfig.Postgres.Host,
		Port:            config.AppConfig.Postgres.Port,
		User:            config.AppConfig.Postgres.User,
		Password:        config.AppConfig.Postgres.Password,
		Database:        config.AppConfig.Postgres.Database,
		SSLMode:         config.AppConfig.Postgres.SSLMode,
		TimeZone:        config.AppConfig.Postgres.TimeZone,
		MaxOpenConns:    config.AppConfig.Postgres.MaxOpenConns,
		MaxIdleConns:    config.AppConfig.Postgres.MaxIdleConns,
		ConnMaxLifetime: connMaxLifetime,
	})
	if err != nil {
		log.Fatalf("init postgres: %v", err)
	}
	projectRepo := postgres.NewProjectRepository(db)
	documentRepo := postgres.NewDocumentRepository(db)

	s3Client, err := clients3.NewS3Client(context.Background(), clients3.Config{
		Endpoint:     config.AppConfig.ObjectStorage.Endpoint,
		Region:       config.AppConfig.ObjectStorage.Region,
		AccessKey:    config.AppConfig.ObjectStorage.AccessKey,
		SecretKey:    config.AppConfig.ObjectStorage.SecretKey,
		UsePathStyle: config.AppConfig.ObjectStorage.UsePathStyle,
		Insecure:     config.AppConfig.ObjectStorage.Insecure,
	})
	if err != nil {
		log.Fatalf("init object storage: %v", err)
	}

	s3Ingestion := ingestions3.NewS3FileIngestion(s3Client, "zeus", "")

	storageObjectRepo, err := postgres.NewStorageObjectRepository(db)
	if err != nil {
		log.Fatalf("init storage object repository: %v", err)
	}
	storageObjectSvc := svcstorageobject.NewService(s3Ingestion, storageObjectRepo)
	projectSvc := svcproject.NewService(projectRepo, documentRepo, s3Ingestion, storageObjectSvc)

	router := gin.Default()
	router.Use(handler.CORSMiddleware())
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
