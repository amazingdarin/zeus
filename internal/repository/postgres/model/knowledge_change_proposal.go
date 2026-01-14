package model

import (
	"time"

	"gorm.io/datatypes"
)

type KnowledgeChangeProposal struct {
	ID        string         `gorm:"column:id;primaryKey"`
	ProjectID string         `gorm:"column:project_id;not null"`
	DocID     string         `gorm:"column:doc_id;not null"`
	Status    string         `gorm:"column:status;not null"`
	Meta      datatypes.JSON `gorm:"column:meta;type:jsonb"`
	Content   datatypes.JSON `gorm:"column:content;type:jsonb"`
	CreatedAt time.Time      `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt time.Time      `gorm:"column:updated_at;autoUpdateTime"`
}

func (KnowledgeChangeProposal) TableName() string {
	return "knowledge_change_proposal"
}
