package model

import (
	"time"

	"gorm.io/datatypes"
)

type ModelScenarioConfig struct {
	ID         string         `gorm:"column:id;primaryKey"`
	Scenario   string         `gorm:"column:scenario;not null;unique"`
	ProviderID string         `gorm:"column:provider_id;not null"`
	ModelName  string         `gorm:"column:model_name;not null"`
	Parameters datatypes.JSON `gorm:"column:parameters;type:jsonb"`
	IsActive   bool           `gorm:"column:is_active;not null"`
	CreatedAt  time.Time      `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt  time.Time      `gorm:"column:updated_at;autoUpdateTime"`
}

func (ModelScenarioConfig) TableName() string {
	return "model_scenario_config"
}
