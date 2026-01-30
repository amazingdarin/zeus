package postgres

import (
	"fmt"
	"os"
	"strings"
	"time"

	log "github.com/sirupsen/logrus"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const defaultPort = 5432

type Config struct {
	Host            string
	Port            int
	User            string
	Password        string
	Database        string
	SSLMode         string
	TimeZone        string
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
}

func (c Config) DSN() (string, error) {
	host := strings.TrimSpace(c.Host)
	if host == "" {
		return "", fmt.Errorf("host is required")
	}
	user := strings.TrimSpace(c.User)
	if user == "" {
		return "", fmt.Errorf("user is required")
	}
	database := strings.TrimSpace(c.Database)
	if database == "" {
		return "", fmt.Errorf("database is required")
	}

	port := c.Port
	if port == 0 {
		port = defaultPort
	}
	sslMode := strings.TrimSpace(c.SSLMode)
	if sslMode == "" {
		sslMode = "disable"
	}
	timeZone := strings.TrimSpace(c.TimeZone)
	if timeZone == "" {
		timeZone = "UTC"
	}

	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		host,
		port,
		user,
		c.Password,
		database,
		sslMode,
		timeZone,
	), nil
}

func NewGormDB(cfg Config) *gorm.DB {
	dsn, err := cfg.DSN()
	if err != nil {
		return nil
	}
	logLevel := logger.Info
	if strings.EqualFold(os.Getenv("ZEUS_GORM_LOG_LEVEL"), "warn") {
		logLevel = logger.Warn
	} else if strings.EqualFold(os.Getenv("ZEUS_GORM_LOG_LEVEL"), "error") {
		logLevel = logger.Error
	} else if strings.EqualFold(os.Getenv("ZEUS_GORM_LOG_LEVEL"), "silent") {
		logLevel = logger.Silent
	}

	ormLogger := logger.New(
		log.StandardLogger(),
		logger.Config{
			SlowThreshold:             200 * time.Millisecond,
			LogLevel:                  logLevel,
			IgnoreRecordNotFoundError: false,
			Colorful:                  false,
		},
	)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: ormLogger})
	if err != nil {
		return nil
	}
	sqlDB, err := db.DB()
	if err != nil {
		return db
	}
	if cfg.MaxOpenConns > 0 {
		sqlDB.SetMaxOpenConns(cfg.MaxOpenConns)
	}
	if cfg.MaxIdleConns > 0 {
		sqlDB.SetMaxIdleConns(cfg.MaxIdleConns)
	}
	if cfg.ConnMaxLifetime > 0 {
		sqlDB.SetConnMaxLifetime(cfg.ConnMaxLifetime)
	}
	return db
}
