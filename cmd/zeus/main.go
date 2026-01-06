package main

import (
	"context"
	"os"

	"zeus/internal/api/middleware"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"

	"zeus/internal/api/handler"
	"zeus/internal/config"
	"zeus/internal/infra/assetcontent"
	"zeus/internal/infra/assetmeta"
	clients3 "zeus/internal/infra/client/s3"
	"zeus/internal/infra/gitadmin"
	"zeus/internal/infra/gitclient"
	"zeus/internal/infra/gittemp"
	ingestions3 "zeus/internal/infra/ingestion/s3"
	"zeus/internal/infra/objectstorage"
	"zeus/internal/infra/searchindex"
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
	storageObjectSvc := svcstorageobject.NewService(s3Ingestion, s3Client, storageObjectRepo)
	gitAuthorName := getenv("ZEUS_GIT_AUTHOR_NAME", config.AppConfig.Git.AuthorName)
	gitAuthorEmail := getenv("ZEUS_GIT_AUTHOR_EMAIL", config.AppConfig.Git.AuthorEmail)
	gitBranch := getenv("ZEUS_GIT_BRANCH", config.AppConfig.Git.DefaultBranch)
	gitRepoRoot := getenv("ZEUS_GIT_REPO_ROOT", config.AppConfig.Git.RepoRoot)
	gitBareRepoRoot := getenv("ZEUS_GIT_BARE_ROOT", config.AppConfig.Git.BareRepoRoot)
	gitRepoURLPrefix := getenv("ZEUS_GIT_REPO_URL_PREFIX", config.AppConfig.Git.RepoURLPrefix)
	if gitBareRepoRoot == "" {
		gitBareRepoRoot = gitadmin.DefaultBareRepoRoot
	}

	gitAdmin := gitadmin.NewExecAdmin(gitBareRepoRoot, gitRepoURLPrefix, log.WithField("component", "git-admin"))
	gitClient := gitclient.NewClient(log.WithField("component", "git"))
	if gitRepoRoot == "" {
		gitRepoRoot = gitclient.DefaultRepoRoot
	}
	gitclient.SetRepoRoot(gitRepoRoot)

	assetPolicy := ingestion.DefaultPolicy{}
	gitTempStorage := gittemp.NewGitTempAssetStorage(gitRepoRoot)
	objectStorage := objectstorage.NewObjectStorageAssetStorage(
		s3Client,
		config.AppConfig.ObjectStorage.Bucket,
	)
	assetMetaRoot := getenv("ZEUS_ASSET_META_ROOT", config.AppConfig.Asset.MetaRoot)
	assetMetaStore := assetmeta.NewFileStore(assetMetaRoot)
	assetReader := assetcontent.NewReader(s3Client)
	assetSvc, err := svcasset.NewService(
		assetPolicy,
		gitTempStorage,
		objectStorage,
		assetMetaStore,
		assetReader,
	)
	if err != nil {
		log.Fatalf("init asset service: %v", err)
	}
	openapiIndexSvc, err := svcopenapi.NewIndexService(assetMetaStore, assetReader)
	if err != nil {
		log.Fatalf("init openapi service: %v", err)
	}

	projectSvc := svcproject.NewService(
		projectRepo,
		gitAdmin,
		gitClient,
		gitAuthorName,
		gitAuthorEmail,
		gitBranch,
	)

	knowledgeRepo := gitrepo.NewKnowledgeRepository(gitClient, projectRepo, "")
	knowledgeSvc, err := svcknowledge.NewService(
		knowledgeRepo,
		projectRepo,
		gitClient,
		gitAuthorName,
		gitAuthorEmail,
		"",
	)
	if err != nil {
		log.Fatalf("init knowledge service: %v", err)
	}

	searchIndexRoot := getenv("ZEUS_SEARCH_INDEX_ROOT", config.AppConfig.Search.IndexRoot)
	if searchIndexRoot == "" {
		searchIndexRoot = searchindex.DefaultIndexRoot
	}
	indexBuilder := searchindex.NewIndexBuilder(knowledgeRepo, searchIndexRoot)
	searchSvc := svcsearch.NewService(indexBuilder)

	router := gin.Default()
	router.Use(middleware.CORSMiddleware())
	handler.RegisterRoutes(
		router,
		storageObjectSvc,
		assetSvc,
		projectSvc,
		knowledgeSvc,
		searchSvc,
		openapiIndexSvc,
	)

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
