package app

import (
	"context"
	"os"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"gorm.io/gorm"

	"zeus/internal/api/handler"
	"zeus/internal/config"
	corelog "zeus/internal/core/log"
	coremiddleware "zeus/internal/core/middleware"
	coreutil "zeus/internal/core/util"
	"zeus/internal/infra/assetcontent"
	"zeus/internal/infra/assetmeta"
	clients3 "zeus/internal/infra/client/s3"
	"zeus/internal/infra/convert"
	"zeus/internal/infra/embedding"
	"zeus/internal/infra/gitadmin"
	"zeus/internal/infra/gitclient"
	ingestions3 "zeus/internal/infra/ingestion/s3"
	"zeus/internal/infra/llm"
	"zeus/internal/infra/localstorage"
	"zeus/internal/infra/modelruntime"
	providerinfra "zeus/internal/infra/provider"
	"zeus/internal/infra/searchindex"
	httpsession "zeus/internal/infra/session"
	"zeus/internal/infra/taskcallback"
	docsvc "zeus/internal/modules/document/service"
	searchsvc "zeus/internal/modules/knowledge/search/service"
	knowledgesvc "zeus/internal/modules/knowledge/service"
	projectrepo "zeus/internal/modules/project/repository/postgres"
	projectsvc "zeus/internal/modules/project/service"
	"zeus/internal/repository"
	gitrepo "zeus/internal/repository/git"
	"zeus/internal/repository/postgres"
	"zeus/internal/repository/ragindex"
	svcasset "zeus/internal/service/asset"
	"zeus/internal/service/chatrun"
	"zeus/internal/service/chatstream"
	svcconvert "zeus/internal/service/convert"
	svcmodel "zeus/internal/service/model"
	svcopenapi "zeus/internal/service/openapi"
	svcprovider "zeus/internal/service/provider"
	svcrag "zeus/internal/service/rag"
	svcstorageobject "zeus/internal/service/storage_object"
	svctask "zeus/internal/service/task"
)

func InitConfig(ctx context.Context) {
	configPath := Getenv("ZEUS_CONFIG_PATH", "config.yaml")
	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	config.AppConfig = cfg
}

func InitLogger() {
	log.SetReportCaller(true)
	log.SetFormatter(&corelog.ErrorCallerFormatter{Base: log.StandardLogger().Formatter})
	log.AddHook(&corelog.SessionHook{})
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

func InitRepository(db *gorm.DB, gitClientManager *gitclient.GitClientManager) repository.Repository {
	return repository.Repository{
		Project:                 projectrepo.NewProjectRepository(db),
		StorageObject:           postgres.NewStorageObjectRepository(db),
		ModelRuntime:            postgres.NewModelRuntimeRepository(db),
		ProviderConnection:      postgres.NewProviderConnectionRepository(db),
		ProviderCredential:      postgres.NewProviderCredentialRepository(db),
		DocumentSummary:         postgres.NewDocumentSummaryRepository(db),
		Task:                    postgres.NewTaskRepository(db),
		KnowledgeChangeProposal: postgres.NewKnowledgeChangeProposalRepository(db),
		Knowledge:               gitrepo.NewKnowledgeRepository(gitClientManager),
		Document:                postgres.NewDocumentRepository(db),
	}
}

func BuildRouter(ctx context.Context) *gin.Engine {
	InitLogger()
	InitConfig(ctx)
	gitAdmin := InitGitAdmin()
	gitClientManager := InitGitClientManager(ctx)
	db := InitDB(ctx)
	s3Client, s3Ingestion := InitS3(ctx)
	repos := InitRepository(db, gitClientManager)

	storageObjectSvc := svcstorageobject.NewService(s3Ingestion, s3Client, repos)
	pandoc := convert.NewPandoc("")
	convertSvc := svcconvert.NewService(pandoc)

	assetMetaRoot := Getenv("ZEUS_ASSET_META_ROOT", config.AppConfig.Asset.MetaRoot)
	localFileStorage := localstorage.NewLocalAssetStorage(assetMetaRoot)
	assetMetaStore := assetmeta.NewFileStore(assetMetaRoot)
	assetReader := assetcontent.NewReader(s3Client)
	assetSvc := svcasset.NewService(localFileStorage, assetMetaStore, assetReader, repos)
	openapiIndexSvc := svcopenapi.NewIndexService(assetMetaStore, assetReader)
	projectSvc := projectsvc.NewService(repos, gitAdmin, gitClientManager)
	keyManager, err := coreutil.NewLocalKeyManager(config.AppConfig.Security)
	if err != nil {
		log.WithContext(ctx).Fatalf("init key manager: %v", err)
	}
	copilotClient := providerinfra.NewCopilotDeviceClient(
		config.AppConfig.Providers.Copilot.ClientID,
		config.AppConfig.Providers.Copilot.Scopes,
	)
	providerRegistry := svcprovider.NewRegistry()
	providerCredentialSvc := svcprovider.NewCredentialService(repos, keyManager, copilotClient)
	providerConnectionSvc := svcprovider.NewConnectionService(
		repos,
		providerRegistry,
		modelruntime.DefaultClientFactory,
		keyManager,
	)
	modelRuntimeSvc := svcmodel.NewRuntimeService(
		repos,
		modelruntime.DefaultClientFactory,
		config.AppConfig.Security.EncryptionKey,
	)

	searchIndexRoot := Getenv("ZEUS_SEARCH_INDEX_ROOT", config.AppConfig.Search.IndexRoot)
	if searchIndexRoot == "" {
		searchIndexRoot = searchindex.DefaultIndexRoot
	}
	indexBuilder := searchindex.NewIndexBuilder(repos.Knowledge, searchIndexRoot)
	searchSvc := searchsvc.NewService(indexBuilder)
	knowledgeSvc := knowledgesvc.NewService(repos)
	documentSvc := docsvc.NewService(config.AppConfig.Git.RepoRoot)

	ragIndex := ragindex.NewPostgresIndex(db)
	ragExtractor := svcrag.SimpleBlockExtractor{}
	runtimeResolver := svcmodel.NewRuntimeResolver(
		repos,
		keyManager,
		config.AppConfig.Security.EncryptionKey,
	)
	ragEmbedder := embedding.NewOpenAICompatibleEmbedder(runtimeResolver)
	ragReader := gitrepo.NewGitDocumentReader(repos.Knowledge, repos.Project)
	ragSvc := svcrag.NewService(ragReader, ragExtractor, ragEmbedder, ragIndex, svcrag.SimpleAssembler{})
	summaryLLM := llm.NewOpenAICompatibleClient()
	summarySvc := svcrag.NewSummaryService(
		ragReader,
		ragExtractor,
		repos,
		summaryLLM,
		runtimeResolver,
	)
	taskSvc := svctask.NewService(repos)

	slashRouter := chatstream.NewDefaultSlashRouter([]chatstream.SlashCommand{}, nil)
	chatRunRegistry := chatrun.NewMemoryRunRegistry()
	chatStreamSvc := chatstream.NewService(
		ragSvc,
		runtimeResolver,
		llm.NewOpenAIStreamClient(3*time.Minute),
		slashRouter,
		knowledgeSvc,
	)

	taskWorker := svctask.NewWorker(
		repos.Task,
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

	router := gin.Default()
	router.Use(coremiddleware.LoggerMiddleware())
	router.Use(coremiddleware.CORSMiddleware())
	router.Use(coremiddleware.SessionMiddleware(sessionManager))
	handler.RegisterRoutes(
		router,
		storageObjectSvc,
		assetSvc,
		projectSvc,
		documentSvc,
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
		convertSvc,
	)

	return router
}

func Getenv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
