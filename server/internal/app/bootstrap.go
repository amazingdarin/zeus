package app

import (
	"context"
	"os"
	"time"

	projectsvc "zeus/internal/modules/project/service/project"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"gorm.io/gorm"

	"zeus/internal/api/handler"
	"zeus/internal/config"
	corelog "zeus/internal/core/log"
	coremiddleware "zeus/internal/core/middleware"
	clients3 "zeus/internal/infra/client/s3"
	"zeus/internal/infra/gitadmin"
	"zeus/internal/infra/gitclient"
	ingestions3 "zeus/internal/infra/ingestion/s3"
	"zeus/internal/infra/jwt"
	httpsession "zeus/internal/infra/session"
	authsvc "zeus/internal/modules/auth/service"
	projectrepo "zeus/internal/modules/project/repository/postgres"
	teampostgres "zeus/internal/modules/team/repository/postgres"
	teamsvc "zeus/internal/modules/team/service"
	userpostgres "zeus/internal/modules/user/repository/postgres"
	usersvc "zeus/internal/modules/user/service"
	"zeus/internal/repository"
	"zeus/internal/repository/postgres"
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
		Project:            projectrepo.NewProjectRepository(db),
		Task:               postgres.NewTaskRepository(db),
		KnowledgeFulltext:  postgres.NewKnowledgeFulltextRepository(db),
		KnowledgeEmbedding: postgres.NewKnowledgeEmbeddingRepository(db),
	}
}

func InitJWTManager() *jwt.JWTManager {
	accessTTL, err := config.AppConfig.Auth.AccessTokenTTLDuration()
	if err != nil {
		log.Fatalf("parse access_token_ttl: %v", err)
	}
	refreshTTL, err := config.AppConfig.Auth.RefreshTokenTTLDuration()
	if err != nil {
		log.Fatalf("parse refresh_token_ttl: %v", err)
	}
	return jwt.NewJWTManager(
		config.AppConfig.Auth.JWTSecret,
		accessTTL,
		refreshTTL,
	)
}

func InitAuthService(db *gorm.DB, projectSvc *projectsvc.Service, jwtManager *jwt.JWTManager) *authsvc.AuthService {
	userRepo := userpostgres.NewUserRepository(db)
	sessionRepo := userpostgres.NewSessionRepository(db)
	return authsvc.NewAuthService(
		userRepo,
		sessionRepo,
		projectSvc,
		jwtManager,
		config.AppConfig.Auth.BcryptCost,
	)
}

func InitUserService(db *gorm.DB) *usersvc.UserService {
	userRepo := userpostgres.NewUserRepository(db)
	return usersvc.NewUserService(userRepo, config.AppConfig.Auth.BcryptCost)
}

func InitTeamService(db *gorm.DB) *teamsvc.TeamService {
	teamRepo := teampostgres.NewTeamRepository(db)
	userRepo := userpostgres.NewUserRepository(db)
	return teamsvc.NewTeamService(teamRepo, userRepo)
}

func BuildRouter(ctx context.Context) *gin.Engine {
	InitLogger()
	InitConfig(ctx)
	gitAdmin := InitGitAdmin()
	gitClientManager := InitGitClientManager(ctx)
	db := InitDB(ctx)
	_, _ = InitS3(ctx)
	repos := InitRepository(db, gitClientManager)

	// Initialize services
	projectSvc := projectsvc.NewService(repos, gitAdmin, gitClientManager)
	jwtManager := InitJWTManager()
	authSvc := InitAuthService(db, projectSvc, jwtManager)
	userSvc := InitUserService(db)
	teamSvc := InitTeamService(db)
	sessionManager := httpsession.NewSessionManager(nil)

	router := gin.Default()
	router.Use(coremiddleware.LoggerMiddleware())
	router.Use(coremiddleware.CORSMiddleware())
	router.Use(coremiddleware.SessionMiddleware(sessionManager))
	handler.RegisterRoutes(
		router,
		handler.Services{
			ProjectSvc: projectSvc,
			AuthSvc:    authSvc,
			UserSvc:    userSvc,
			TeamSvc:    teamSvc,
			JWTManager: jwtManager,
		},
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
