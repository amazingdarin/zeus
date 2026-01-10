package config

import (
	"fmt"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	Server        ServerConfig        `mapstructure:"server"`
	Postgres      PostgresConfig      `mapstructure:"postgres"`
	ObjectStorage ObjectStorageConfig `mapstructure:"object_storage"`
	Asset         AssetConfig         `mapstructure:"asset"`
	Git           GitConfig           `mapstructure:"git"`
	Search        SearchConfig        `mapstructure:"search"`
	Security      SecurityConfig      `mapstructure:"security"`
}

var AppConfig *Config

type ServerConfig struct {
	Addr string `mapstructure:"addr"`
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

type SecurityConfig struct {
	EncryptionKey string `mapstructure:"encryption_key"`
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
}
