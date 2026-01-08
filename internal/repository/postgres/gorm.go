package postgres

import (
	"fmt"
	"strings"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
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
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
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
