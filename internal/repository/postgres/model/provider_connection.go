package model

import "time"

type ProviderConnection struct {
	ID           string     `gorm:"column:id;primaryKey"`
	ProviderID   string     `gorm:"column:provider_id;not null"`
	DisplayName  string     `gorm:"column:display_name;not null"`
	BaseURL      string     `gorm:"column:base_url"`
	ModelName    string     `gorm:"column:model_name;not null"`
	CredentialID string     `gorm:"column:credential_id;not null"`
	Status       string     `gorm:"column:status;not null"`
	LastError    string     `gorm:"column:last_error"`
	LastUsedAt   *time.Time `gorm:"column:last_used_at"`
	CreatedAt    time.Time  `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt    time.Time  `gorm:"column:updated_at;autoUpdateTime"`
	CreatedBy    string     `gorm:"column:created_by"`
	UpdatedBy    string     `gorm:"column:updated_by"`
}

func (ProviderConnection) TableName() string {
	return "provider_connection"
}
