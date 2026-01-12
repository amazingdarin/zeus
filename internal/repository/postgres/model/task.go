package model

import (
	"time"

	"gorm.io/datatypes"
)

type Task struct {
	ID             string         `gorm:"column:id;primaryKey"`
	Type           string         `gorm:"column:type;not null"`
	ProjectID      string         `gorm:"column:project_id;not null"`
	Payload        datatypes.JSON `gorm:"column:payload;type:jsonb"`
	Status         string         `gorm:"column:status;not null"`
	Attempts       int            `gorm:"column:attempts;not null"`
	MaxAttempts    int            `gorm:"column:max_attempts;not null"`
	ScheduledAt    *time.Time     `gorm:"column:scheduled_at"`
	StartedAt      *time.Time     `gorm:"column:started_at"`
	FinishedAt     *time.Time     `gorm:"column:finished_at"`
	LastHeartbeat  *time.Time     `gorm:"column:last_heartbeat"`
	LockOwner      string         `gorm:"column:lock_owner"`
	LockExpiresAt  *time.Time     `gorm:"column:lock_expires_at"`
	Result         datatypes.JSON `gorm:"column:result;type:jsonb"`
	ErrorMessage   string         `gorm:"column:error_message"`
	CallbackURL    string         `gorm:"column:callback_url"`
	CallbackSecret string         `gorm:"column:callback_secret"`
	CreatedAt      time.Time      `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt      time.Time      `gorm:"column:updated_at;autoUpdateTime"`
}

func (Task) TableName() string {
	return "task"
}
