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
	"zeus/internal/infra/embedding"
	"zeus/internal/infra/gitadmin"
	"zeus/internal/infra/gitclient"
	"zeus/internal/infra/gittemp"
	ingestions3 "zeus/internal/infra/ingestion/s3"
	"zeus/internal/infra/llm"
	"zeus/internal/infra/logger"
	"zeus/internal/infra/modelruntime"
	"zeus/internal/infra/objectstorage"
	providerinfra "zeus/internal/infra/provider"
	"zeus/internal/infra/searchindex"
	httpsession "zeus/internal/infra/session"
	"zeus/internal/infra/taskcallback"
	"zeus/internal/ingestion"
	gitrepo "zeus/internal/repository/git"
	"zeus/internal/repository/postgres"
	"zeus/internal/repository/ragindex"
	svcasset "zeus/internal/service/asset"
	"zeus/internal/service/chatrun"
	"zeus/internal/service/chatstream"
	svcknowledge "zeus/internal/service/knowledge"
	svcmodel "zeus/internal/service/model"
	svcopenapi "zeus/internal/service/openapi"
	svcproject "zeus/internal/service/project"
	svcprovider "zeus/internal/service/provider"
	svcrag "zeus/internal/service/rag"
	svcsearch "zeus/internal/service/search"
	svcstorageobject "zeus/internal/service/storage_object"
	svctask "zeus/internal/service/task"
	"zeus/internal/util"
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
	modelRuntimeRepo := postgres.NewModelRuntimeRepository(db)
	providerConnectionRepo := postgres.NewProviderConnectionRepository(db)
	providerCredentialRepo := postgres.NewProviderCredentialRepository(db)
	summaryRepo := postgres.NewDocumentSummaryRepository(db)
	taskRepo := postgres.NewTaskRepository(db)
	changeProposalRepo := postgres.NewKnowledgeChangeProposalRepository(db)
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
	assetSvc := svcasset.NewService(
		assetPolicy,
		gitTempStorage,
		objectStorage,
		assetMetaStore,
		assetReader,
		projectRepo,
	)
	openapiIndexSvc := svcopenapi.NewIndexService(assetMetaStore, assetReader)
	projectSvc := svcproject.NewService(projectRepo, gitAdmin, gitClientManager)
	keyManager, err := util.NewLocalKeyManager(config.AppConfig.Security)
	if err != nil {
		log.WithContext(ctx).Fatalf("init key manager: %v", err)
	}
	copilotClient := providerinfra.NewCopilotDeviceClient(
		config.AppConfig.Providers.Copilot.ClientID,
		config.AppConfig.Providers.Copilot.Scopes,
	)
	providerRegistry := svcprovider.NewRegistry()
	providerCredentialSvc := svcprovider.NewCredentialService(providerCredentialRepo, keyManager, copilotClient)
	providerConnectionSvc := svcprovider.NewConnectionService(
		providerConnectionRepo,
		providerCredentialRepo,
		providerRegistry,
		modelruntime.DefaultClientFactory,
		keyManager,
	)
	modelRuntimeSvc := svcmodel.NewRuntimeService(
		modelRuntimeRepo,
		modelruntime.DefaultClientFactory,
		config.AppConfig.Security.EncryptionKey,
	)

	searchIndexRoot := getenv("ZEUS_SEARCH_INDEX_ROOT", config.AppConfig.Search.IndexRoot)
	if searchIndexRoot == "" {
		searchIndexRoot = searchindex.DefaultIndexRoot
	}
	indexBuilder := searchindex.NewIndexBuilder(knowledgeRepo, searchIndexRoot)
	searchSvc := svcsearch.NewService(indexBuilder)
	knowledgeSvc := svcknowledge.NewService(knowledgeRepo, projectRepo, changeProposalRepo)
	ragIndex := ragindex.NewPostgresIndex(db)
	ragExtractor := svcrag.SimpleBlockExtractor{}
	runtimeResolver := svcmodel.NewRuntimeResolver(
		modelRuntimeRepo,
		providerConnectionRepo,
		providerCredentialRepo,
		keyManager,
		config.AppConfig.Security.EncryptionKey,
	)
	ragEmbedder := embedding.NewOpenAICompatibleEmbedder(runtimeResolver)
	ragReader := gitrepo.NewGitDocumentReader(knowledgeRepo, projectRepo)
	ragSvc := svcrag.NewService(ragReader, ragExtractor, ragEmbedder, ragIndex, svcrag.SimpleAssembler{})
	summaryLLM := llm.NewOpenAICompatibleClient()
	summarySvc := svcrag.NewSummaryService(
		ragReader,
		ragExtractor,
		summaryRepo,
		summaryLLM,
		runtimeResolver,
	)
	taskSvc := svctask.NewService(taskRepo)
	chatRunRegistry := chatrun.NewMemoryRunRegistry()
	slashRouter := chatstream.NewDefaultSlashRouter(
		[]chatstream.SlashCommand{
			{
				Name:        "docs.list",
				Type:        chatstream.SlashCommandOperation,
				Description: "List knowledge base documents",
			},
			{
				Name:        "docs.search",
				Type:        chatstream.SlashCommandOperation,
				Description: "Search knowledge base documents",
			},
			{
				Name:        "propose",
				Type:        chatstream.SlashCommandPrompt,
				Description: "Create a knowledge change proposal",
				Template: `You are preparing a change proposal for a knowledge base document.
Return ONLY valid JSON with the following fields:
- doc_id (string)
- meta (optional, object)
- content (TipTap JSON object, or {meta,content})

User request:
{{input}}`,
			},
		},
		chatstream.NewKnowledgeToolInvoker(knowledgeSvc, searchSvc),
	)
	chatStreamSvc := chatstream.NewService(
		ragSvc,
		runtimeResolver,
		llm.NewOpenAIStreamClient(3*time.Minute),
		slashRouter,
		knowledgeSvc,
	)

	taskWorker := svctask.NewWorker(
		taskRepo,
		[]svctask.Handler{
			svctask.NewRagRebuildProjectHandler(ragSvc, summarySvc),
		},
		taskcallback.NewHTTPSender(),
		"worker-1",
		3*time.Second,
		2*time.Minute,
	)
	go taskWorker.Start(ctx)

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
		ragSvc,
		summarySvc,
		taskSvc,
		openapiIndexSvc,
		modelRuntimeSvc,
		providerRegistry,
		providerCredentialSvc,
		providerConnectionSvc,
		chatRunRegistry,
		chatStreamSvc,
		slashRouter,
		config.AppConfig.Git.RepoRoot,
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
