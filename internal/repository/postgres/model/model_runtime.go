package model

import (
	"time"

	"gorm.io/datatypes"
)

type ModelRuntime struct {
	ID         string         `gorm:"column:id;primaryKey"`
	Scenario   string         `gorm:"column:scenario;not null;unique"`
	Name       string         `gorm:"column:name;not null"`
	BaseURL    string         `gorm:"column:base_url;not null"`
	APIKey     string         `gorm:"column:api_key"`
	ModelName  string         `gorm:"column:model_name;not null"`
	Parameters datatypes.JSON `gorm:"column:parameters;type:jsonb"`
	IsActive   bool           `gorm:"column:is_active;not null"`
	CreatedAt  time.Time      `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt  time.Time      `gorm:"column:updated_at;autoUpdateTime"`
}

func (ModelRuntime) TableName() string {
	return "model_runtime"
}
