package domain

import (
	"fmt"
	"strings"
	"time"
)

type Session struct {
	ID         string
	UserID     string
	TokenHash  string
	DeviceInfo string
	IPAddress  string
	ExpiresAt  time.Time
	CreatedAt  time.Time
}

func (s Session) Validate() error {
	if strings.TrimSpace(s.ID) == "" {
		return fmt.Errorf("session id is required")
	}
	if strings.TrimSpace(s.UserID) == "" {
		return fmt.Errorf("user id is required")
	}
	if strings.TrimSpace(s.TokenHash) == "" {
		return fmt.Errorf("token hash is required")
	}
	if s.ExpiresAt.IsZero() {
		return fmt.Errorf("expires at is required")
	}
	return nil
}

func (s Session) IsExpired() bool {
	return time.Now().After(s.ExpiresAt)
}
