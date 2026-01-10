package model

import (
	"time"

	"gorm.io/datatypes"
)

type ModelProvider struct {
	ID          string         `gorm:"column:id;primaryKey"`
	Name        string         `gorm:"column:name;not null"`
	Type        string         `gorm:"column:type;not null"`
	BaseURL     string         `gorm:"column:base_url;not null"`
	AccessKey   string         `gorm:"column:access_key;not null"`
	ExtraConfig datatypes.JSON `gorm:"column:extra_config;type:jsonb"`
	IsEnabled   bool           `gorm:"column:is_enabled;not null"`
	CreatedAt   time.Time      `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt   time.Time      `gorm:"column:updated_at;autoUpdateTime"`
}

func (ModelProvider) TableName() string {
	return "model_provider"
}
