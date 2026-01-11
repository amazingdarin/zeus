package model

import "time"

type DocumentSummary struct {
	ID          string    `gorm:"column:id;primaryKey"`
	ProjectID   string    `gorm:"column:project_id;not null"`
	DocID       string    `gorm:"column:doc_id;not null"`
	SummaryText string    `gorm:"column:summary_text;type:text;not null"`
	ContentHash string    `gorm:"column:content_hash;not null"`
	ModelRef    string    `gorm:"column:model_runtime;not null"`
	CreatedAt   time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt   time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (DocumentSummary) TableName() string {
	return "rag_document_summary"
}
