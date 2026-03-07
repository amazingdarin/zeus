package domain

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

type UserStatus string

const (
	UserStatusActive    UserStatus = "active"
	UserStatusInactive  UserStatus = "inactive"
	UserStatusSuspended UserStatus = "suspended"
	DefaultUserLanguage            = "zh-CN"
)

func (s UserStatus) IsValid() bool {
	switch s {
	case UserStatusActive, UserStatusInactive, UserStatusSuspended:
		return true
	default:
		return false
	}
}

type User struct {
	ID              string
	Email           string
	Username        string
	PasswordHash    string
	DisplayName     string
	Language        string
	AvatarURL       string
	Status          UserStatus
	EmailVerifiedAt *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

var (
	emailRegex    = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	usernameRegex = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{2,29}$`)
)

func (u User) Validate() error {
	if strings.TrimSpace(u.ID) == "" {
		return fmt.Errorf("user id is required")
	}
	if strings.TrimSpace(u.Email) == "" {
		return fmt.Errorf("user email is required")
	}
	if !emailRegex.MatchString(u.Email) {
		return fmt.Errorf("invalid email format")
	}
	if strings.TrimSpace(u.Username) == "" {
		return fmt.Errorf("username is required")
	}
	if !usernameRegex.MatchString(u.Username) {
		return fmt.Errorf("username must be 3-30 characters, start with a letter, and contain only letters, numbers, underscores, or hyphens")
	}
	if strings.TrimSpace(u.PasswordHash) == "" {
		return fmt.Errorf("password hash is required")
	}
	if u.Status == "" {
		return fmt.Errorf("user status is required")
	}
	if !u.Status.IsValid() {
		return fmt.Errorf("invalid user status: %s", u.Status)
	}
	if strings.TrimSpace(u.Language) == "" {
		return fmt.Errorf("user language is required")
	}
	return nil
}

// UserPublicInfo contains only publicly visible user information
type UserPublicInfo struct {
	ID          string
	Username    string
	DisplayName string
	AvatarURL   string
}

func (u User) ToPublicInfo() UserPublicInfo {
	return UserPublicInfo{
		ID:          u.ID,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		AvatarURL:   u.AvatarURL,
	}
}
