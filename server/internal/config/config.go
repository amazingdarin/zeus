package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	Server        ServerConfig        `mapstructure:"server"`
	CodeRunner    CodeRunnerConfig    `mapstructure:"code_runner"`
	Postgres      PostgresConfig      `mapstructure:"postgres"`
	ObjectStorage ObjectStorageConfig `mapstructure:"object_storage"`
	Asset         AssetConfig         `mapstructure:"asset"`
	Git           GitConfig           `mapstructure:"git"`
	Search        SearchConfig        `mapstructure:"search"`
	Embedding     EmbeddingConfig     `mapstructure:"embedding"`
	Security      SecurityConfig      `mapstructure:"security"`
	Providers     ProvidersConfig     `mapstructure:"providers"`
	Auth          AuthConfig          `mapstructure:"auth"`
}

var AppConfig *Config

type ServerConfig struct {
	Addr string `mapstructure:"addr"`
}

type CodeRunnerConfig struct {
	Addr                 string `mapstructure:"addr"`
	InternalToken        string `mapstructure:"internal_token"`
	Namespace            string `mapstructure:"namespace"`
	DefaultTimeoutSecond int    `mapstructure:"default_timeout_seconds"`
	MaxOutputBytes       int    `mapstructure:"max_output_bytes"`
}

type PostgresConfig struct {
	Host            string `mapstructure:"host"`
	Port            int    `mapstructure:"port"`
	User            string `mapstructure:"user"`
	Password        string `mapstructure:"password"`
	Database        string `mapstructure:"database"`
	SSLMode         string `mapstructure:"ssl_mode"`
	TimeZone        string `mapstructure:"time_zone"`
	MaxOpenConns    int    `mapstructure:"max_open_conns"`
	MaxIdleConns    int    `mapstructure:"max_idle_conns"`
	ConnMaxLifetime string `mapstructure:"conn_max_lifetime"`
}

func (p PostgresConfig) ConnMaxLifetimeDuration() (time.Duration, error) {
	if p.ConnMaxLifetime == "" {
		return 0, nil
	}
	return time.ParseDuration(p.ConnMaxLifetime)
}

type ObjectStorageConfig struct {
	Endpoint     string `mapstructure:"endpoint"`
	Region       string `mapstructure:"region"`
	AccessKey    string `mapstructure:"access_key"`
	SecretKey    string `mapstructure:"secret_key"`
	Bucket       string `mapstructure:"bucket"`
	UsePathStyle bool   `mapstructure:"use_path_style"`
	Insecure     bool   `mapstructure:"insecure"`
}

type AssetConfig struct {
	MetaRoot string `mapstructure:"meta_root"`
}

type GitConfig struct {
	RepoRoot        string `mapstructure:"repo_root"`
	SessionRepoRoot string `mapstructure:"session_repo_root"`
	BareRepoRoot    string `mapstructure:"bare_repo_root"`
	RepoURLPrefix   string `mapstructure:"repo_url_prefix"`
	AuthorName      string `mapstructure:"author_name"`
	AuthorEmail     string `mapstructure:"author_email"`
	DefaultBranch   string `mapstructure:"default_branch"`
}

type SearchConfig struct {
	IndexRoot string `mapstructure:"index_root"`
}

type EmbeddingConfig struct {
	BaseURL   string `mapstructure:"base_url"`
	APIKey    string `mapstructure:"api_key"`
	ModelName string `mapstructure:"model_name"`
}

type SecurityConfig struct {
	EncryptionKey    string          `mapstructure:"encryption_key"`
	EncryptionKeys   []EncryptionKey `mapstructure:"encryption_keys"`
	ActiveKeyID      string          `mapstructure:"active_key_id"`
	ActiveKeyVersion int             `mapstructure:"active_key_version"`
}

type EncryptionKey struct {
	ID      string `mapstructure:"id"`
	Version int    `mapstructure:"version"`
	Key     string `mapstructure:"key"`
}

type ProvidersConfig struct {
	Copilot CopilotConfig `mapstructure:"copilot"`
}

type CopilotConfig struct {
	ClientID string   `mapstructure:"client_id"`
	Scopes   []string `mapstructure:"scopes"`
}

type AuthConfig struct {
	JWTSecret       string `mapstructure:"jwt_secret"`
	AccessTokenTTL  string `mapstructure:"access_token_ttl"`
	RefreshTokenTTL string `mapstructure:"refresh_token_ttl"`
	BcryptCost      int    `mapstructure:"bcrypt_cost"`
}

func (a AuthConfig) AccessTokenTTLDuration() (time.Duration, error) {
	if a.AccessTokenTTL == "" {
		return 15 * time.Minute, nil
	}
	return time.ParseDuration(a.AccessTokenTTL)
}

func (a AuthConfig) RefreshTokenTTLDuration() (time.Duration, error) {
	if a.RefreshTokenTTL == "" {
		return 7 * 24 * time.Hour, nil
	}
	return time.ParseDuration(a.RefreshTokenTTL)
}

func Load(path string) (*Config, error) {
	if path == "" {
		return nil, fmt.Errorf("config path is required")
	}

	v := viper.New()
	v.SetConfigFile(path)
	v.SetConfigType("yaml")

	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}

	applyDefaults(&cfg)
	return &cfg, nil
}

func applyDefaults(cfg *Config) {
	if cfg == nil {
		return
	}
	if cfg.Asset.MetaRoot == "" {
		cfg.Asset.MetaRoot = "/var/lib/zeus/assets"
	}
	if cfg.CodeRunner.Addr == "" {
		cfg.CodeRunner.Addr = ":8091"
	}
	if cfg.CodeRunner.Namespace == "" {
		cfg.CodeRunner.Namespace = "default"
	}
	if cfg.CodeRunner.DefaultTimeoutSecond <= 0 {
		cfg.CodeRunner.DefaultTimeoutSecond = 10
	}
	if cfg.CodeRunner.MaxOutputBytes <= 0 {
		cfg.CodeRunner.MaxOutputBytes = 256 * 1024
	}
	if cfg.Git.BareRepoRoot == "" {
		cfg.Git.BareRepoRoot = "/var/lib/zeus/git"
	}
	if cfg.Git.RepoRoot == "" {
		cfg.Git.RepoRoot = "/var/lib/zeus/repos"
	}
	if cfg.Git.SessionRepoRoot == "" {
		cfg.Git.SessionRepoRoot = "/var/lib/zeus/git-sessions"
	}
	if cfg.Git.DefaultBranch == "" {
		cfg.Git.DefaultBranch = "main"
	}
	if cfg.Search.IndexRoot == "" {
		cfg.Search.IndexRoot = "/var/lib/zeus/index"
	}
	if cfg.Security.EncryptionKey == "" {
		cfg.Security.EncryptionKey = "zeus-dev-key"
	}
	if len(cfg.Security.EncryptionKeys) == 0 {
		return
	}
	if strings.TrimSpace(cfg.Security.ActiveKeyID) == "" || cfg.Security.ActiveKeyVersion == 0 {
		cfg.Security.ActiveKeyID = strings.TrimSpace(cfg.Security.EncryptionKeys[0].ID)
		cfg.Security.ActiveKeyVersion = cfg.Security.EncryptionKeys[0].Version
	}
	// Auth defaults
	if cfg.Auth.JWTSecret == "" {
		cfg.Auth.JWTSecret = "zeus-dev-jwt-secret-change-in-production"
	}
	if cfg.Auth.AccessTokenTTL == "" {
		cfg.Auth.AccessTokenTTL = "15m"
	}
	if cfg.Auth.RefreshTokenTTL == "" {
		cfg.Auth.RefreshTokenTTL = "168h" // 7 days
	}
	if cfg.Auth.BcryptCost == 0 {
		cfg.Auth.BcryptCost = 12
	}
}
