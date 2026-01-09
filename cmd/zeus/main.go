package main

import (
	"context"
	"os"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"gorm.io/gorm"

	"zeus/internal/api/handler"
	"zeus/internal/api/middleware"
	"zeus/internal/config"
	"zeus/internal/infra/assetcontent"
	"zeus/internal/infra/assetmeta"
	clients3 "zeus/internal/infra/client/s3"
	"zeus/internal/infra/gitadmin"
	"zeus/internal/infra/gitclient"
	"zeus/internal/infra/gittemp"
	ingestions3 "zeus/internal/infra/ingestion/s3"
	"zeus/internal/infra/logger"
	"zeus/internal/infra/objectstorage"
	"zeus/internal/infra/searchindex"
	httpsession "zeus/internal/infra/session"
	"zeus/internal/ingestion"
	gitrepo "zeus/internal/repository/git"
	"zeus/internal/repository/postgres"
	svcasset "zeus/internal/service/asset"
	svcknowledge "zeus/internal/service/knowledge"
	svcopenapi "zeus/internal/service/openapi"
	svcproject "zeus/internal/service/project"
	svcsearch "zeus/internal/service/search"
	svcstorageobject "zeus/internal/service/storage_object"
)

func InitConfig(ctx context.Context) {
	configPath := getenv("ZEUS_CONFIG_PATH", "config.yaml")
	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	config.AppConfig = cfg
}

func InitLogger() {
	log.SetReportCaller(true)
	log.SetFormatter(&logger.ErrorCallerFormatter{Base: log.StandardLogger().Formatter})
	log.AddHook(&logger.SessionHook{})
}

func InitDB(ctx context.Context) *gorm.DB {
	connMaxLifetime, err := config.AppConfig.Postgres.ConnMaxLifetimeDuration()
	if err != nil {
		log.WithContext(ctx).Fatalf("parse conn_max_lifetime: %v", err)
	}
	db := postgres.NewGormDB(postgres.Config{
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
	if db == nil {
		log.WithContext(ctx).Fatal("init database: nil db")
	}
	return db
}

func InitS3(ctx context.Context) (*s3.Client, *ingestions3.S3FileIngestion) {
	s3Client, err := clients3.NewS3Client(ctx, clients3.Config{
		Endpoint:     config.AppConfig.ObjectStorage.Endpoint,
		Region:       config.AppConfig.ObjectStorage.Region,
		AccessKey:    config.AppConfig.ObjectStorage.AccessKey,
		SecretKey:    config.AppConfig.ObjectStorage.SecretKey,
		UsePathStyle: config.AppConfig.ObjectStorage.UsePathStyle,
		Insecure:     config.AppConfig.ObjectStorage.Insecure,
	})
	if err != nil {
		log.WithContext(ctx).Fatalf("init object storage: %v", err)
	}
	s3Ingestion := ingestions3.NewS3FileIngestion(s3Client, "zeus", "")
	return s3Client, s3Ingestion
}

func InitGitAdmin() *gitadmin.ExecAdmin {
	gitAdmin := gitadmin.NewExecAdmin(config.AppConfig.Git.BareRepoRoot, config.AppConfig.Git.BareRepoRoot, log.WithField("component", "git-admin"))
	return gitAdmin
}

func InitGitClientManager(ctx context.Context) *gitclient.GitClientManager {
	manager := gitclient.NewGitClientManager(config.AppConfig.Git.BareRepoRoot, func(key gitclient.GitKey, baseRepoUrl, repo string) *gitclient.GitClient {
		return gitclient.NewGitClient(
			key,
			gitclient.WithRepoPath(config.AppConfig.Git.RepoRoot+"/"+string(key)),
			gitclient.WithProjectKey(string(key)),
			gitclient.WithRemoteURL(baseRepoUrl+"/"+repo),
			gitclient.WithBranch(config.AppConfig.Git.DefaultBranch),
			gitclient.WithAuthor(config.AppConfig.Git.AuthorName, config.AppConfig.Git.AuthorEmail),
		)
	})
	manager.StartGC(ctx, 2*time.Minute, 10*time.Minute)
	return manager
}

func main() {
	ctx := context.Background()
	InitLogger()
	InitConfig(ctx)
	db := InitDB(ctx)
	s3Client, s3Ingestion := InitS3(ctx)
	gitAdmin := InitGitAdmin()
	gitClientManager := InitGitClientManager(ctx)

	// Init Repositories
	projectRepo := postgres.NewProjectRepository(db)
	storageObjectRepo := postgres.NewStorageObjectRepository(db)
	knowledgeRepo := gitrepo.NewKnowledgeRepository(gitClientManager)

	// Init Services
	storageObjectSvc := svcstorageobject.NewService(s3Ingestion, s3Client, storageObjectRepo)

	assetPolicy := ingestion.DefaultPolicy{}
	gitTempStorage := gittemp.NewGitTempAssetStorage(config.AppConfig.Git.RepoRoot)
	objectStorage := objectstorage.NewObjectStorageAssetStorage(
		s3Client,
		config.AppConfig.ObjectStorage.Bucket,
	)
	assetMetaRoot := getenv("ZEUS_ASSET_META_ROOT", config.AppConfig.Asset.MetaRoot)
	assetMetaStore := assetmeta.NewFileStore(assetMetaRoot)
	assetReader := assetcontent.NewReader(s3Client)
	assetSvc := svcasset.NewService(assetPolicy, gitTempStorage, objectStorage, assetMetaStore, assetReader)
	openapiIndexSvc := svcopenapi.NewIndexService(assetMetaStore, assetReader)
	projectSvc := svcproject.NewService(projectRepo, gitAdmin, gitClientManager)

	searchIndexRoot := getenv("ZEUS_SEARCH_INDEX_ROOT", config.AppConfig.Search.IndexRoot)
	if searchIndexRoot == "" {
		searchIndexRoot = searchindex.DefaultIndexRoot
	}
	indexBuilder := searchindex.NewIndexBuilder(knowledgeRepo, searchIndexRoot)
	searchSvc := svcsearch.NewService(indexBuilder)
	knowledgeSvc := svcknowledge.NewService(knowledgeRepo, projectRepo)

	sessionManager := httpsession.NewSessionManager(nil)

	// Register Handlers and Start Server
	router := gin.Default()
	router.Use(middleware.CORSMiddleware())
	router.Use(middleware.SessionMiddleware(sessionManager))
	handler.RegisterRoutes(
		router,
		storageObjectSvc,
		assetSvc,
		projectSvc,
		knowledgeSvc,
		searchSvc,
		openapiIndexSvc,
	)

	if err := router.Run(config.AppConfig.Server.Addr); err != nil {
		log.WithContext(ctx).Fatalf("start server: %v", err)
	}
}

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
