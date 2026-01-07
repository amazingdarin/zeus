package main

import (
	"context"
	"os"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"

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
	"zeus/internal/service"
	svcasset "zeus/internal/service/asset"
	svcknowledge "zeus/internal/service/knowledge"
	svcopenapi "zeus/internal/service/openapi"
	svcproject "zeus/internal/service/project"
	svcsearch "zeus/internal/service/search"
	svcstorageobject "zeus/internal/service/storage_object"
)

func main() {
	logger.InitLogger()
	ctx := context.Background()
	configPath := getenv("ZEUS_CONFIG_PATH", "config.yaml")

	cfg, err := config.Load(configPath)
	if err != nil {
		log.WithContext(ctx).Fatalf("load config: %v", err)
	}
	config.AppConfig = cfg
	addr := config.AppConfig.Server.Addr
	if addr == "" {
		log.WithContext(ctx).Fatal("server addr is required")
	}
	connMaxLifetime, err := config.AppConfig.Postgres.ConnMaxLifetimeDuration()
	if err != nil {
		log.WithContext(ctx).Fatalf("parse conn_max_lifetime: %v", err)
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
		log.WithContext(ctx).Fatalf("init postgres: %v", err)
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
		log.WithContext(ctx).Fatalf("init object storage: %v", err)
	}

	s3Ingestion := ingestions3.NewS3FileIngestion(s3Client, "zeus", "")

	storageObjectRepo, err := postgres.NewStorageObjectRepository(db)
	if err != nil {
		log.WithContext(ctx).Fatalf("init storage object repository: %v", err)
	}
	storageObjectSvc := svcstorageobject.NewService(s3Ingestion, s3Client, storageObjectRepo)
	gitAuthorName := getenv("ZEUS_GIT_AUTHOR_NAME", config.AppConfig.Git.AuthorName)
	gitAuthorEmail := getenv("ZEUS_GIT_AUTHOR_EMAIL", config.AppConfig.Git.AuthorEmail)
	gitBranch := getenv("ZEUS_GIT_BRANCH", config.AppConfig.Git.DefaultBranch)
	gitRepoRoot := getenv("ZEUS_GIT_REPO_ROOT", config.AppConfig.Git.RepoRoot)
	gitSessionRepoRoot := getenv("ZEUS_GIT_SESSION_ROOT", config.AppConfig.Git.SessionRepoRoot)
	gitBareRepoRoot := getenv("ZEUS_GIT_BARE_ROOT", config.AppConfig.Git.BareRepoRoot)
	gitRepoURLPrefix := getenv("ZEUS_GIT_REPO_URL_PREFIX", config.AppConfig.Git.RepoURLPrefix)
	if gitBareRepoRoot == "" {
		gitBareRepoRoot = gitadmin.DefaultBareRepoRoot
	}

	gitAdmin := gitadmin.NewExecAdmin(gitBareRepoRoot, gitRepoURLPrefix, log.WithField("component", "git-admin"))
	gitClient := gitclient.NewClientFactory(log.WithField("component", "git"))
	if gitRepoRoot == "" {
		gitRepoRoot = gitclient.DefaultRepoRoot
	}
	gitclient.SetRepoRoot(gitRepoRoot)
	if gitSessionRepoRoot == "" {
		gitSessionRepoRoot = gitclient.DefaultSessionRepoRoot
	}
	gitclient.SetSessionRepoRoot(gitSessionRepoRoot)
	sessionGitManager := gitclient.NewSessionGitManager(gitSessionRepoRoot, gitClient)
	handler.SetSessionGitManager(sessionGitManager)
	sessionManager := httpsession.NewSessionManager(sessionGitManager.Release)

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
		log.WithContext(ctx).Fatalf("init asset service: %v", err)
	}
	openapiIndexSvc, err := svcopenapi.NewIndexService(assetMetaStore, assetReader)
	if err != nil {
		log.WithContext(ctx).Fatalf("init openapi service: %v", err)
	}

	projectSvc := svcproject.NewService(
		projectRepo,
		gitAdmin,
		gitClient,
		gitAuthorName,
		gitAuthorEmail,
		gitBranch,
	)

	systemSessionID := "system"
	knowledgeRepo := gitrepo.NewKnowledgeRepository(func(ctx context.Context, projectKey string) (*gitclient.SessionGitClient, error) {
		return sessionGitManager.Get(systemSessionID, projectKey)
	})
	knowledgeFactory := func(sessionGit *gitclient.SessionGitClient) (service.KnowledgeService, error) {
		repo := gitrepo.NewKnowledgeRepositoryWithSession(sessionGit)
		return svcknowledge.NewService(
			repo,
			projectRepo,
			sessionGit,
			gitAuthorName,
			gitAuthorEmail,
			gitBranch,
		)
	}

	searchIndexRoot := getenv("ZEUS_SEARCH_INDEX_ROOT", config.AppConfig.Search.IndexRoot)
	if searchIndexRoot == "" {
		searchIndexRoot = searchindex.DefaultIndexRoot
	}
	indexBuilder := searchindex.NewIndexBuilder(knowledgeRepo, searchIndexRoot)
	searchSvc := svcsearch.NewService(indexBuilder)

	router := gin.Default()
	router.Use(middleware.CORSMiddleware())
	router.Use(middleware.SessionMiddleware(sessionManager))
	handler.RegisterRoutes(
		router,
		storageObjectSvc,
		assetSvc,
		projectSvc,
		knowledgeFactory,
		searchSvc,
		openapiIndexSvc,
	)

	if err = router.Run(addr); err != nil {
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
