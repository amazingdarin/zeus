package model

import "time"

type User struct {
	ID              string     `gorm:"column:id;primaryKey"`
	Email           string     `gorm:"column:email;not null;unique"`
	Username        string     `gorm:"column:username;not null;unique"`
	PasswordHash    string     `gorm:"column:password_hash;not null"`
	DisplayName     string     `gorm:"column:display_name"`
	Language        string     `gorm:"column:language;not null;default:zh-CN"`
	AvatarURL       string     `gorm:"column:avatar_url"`
	Status          string     `gorm:"column:status;not null;default:active"`
	EmailVerifiedAt *time.Time `gorm:"column:email_verified_at"`
	CreatedAt       time.Time  `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt       time.Time  `gorm:"column:updated_at;autoUpdateTime"`
}

func (User) TableName() string {
	return "user"
}

type Session struct {
	ID         string    `gorm:"column:id;primaryKey"`
	UserID     string    `gorm:"column:user_id;not null"`
	TokenHash  string    `gorm:"column:token_hash;not null"`
	DeviceInfo *string   `gorm:"column:device_info"`
	IPAddress  *string   `gorm:"column:ip_address"`
	ExpiresAt  time.Time `gorm:"column:expires_at;not null"`
	CreatedAt  time.Time `gorm:"column:created_at;autoCreateTime"`
}

func (Session) TableName() string {
	return "session"
}
