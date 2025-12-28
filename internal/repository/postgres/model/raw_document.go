package model

import (
	"time"

	"gorm.io/datatypes"
)

type RawDocument struct {
	ID         int64          `gorm:"primaryKey"`
	DocID      string         `gorm:"column:doc_id;uniqueIndex;not null"`
	SourceType string         `gorm:"column:source_type"`
	SourceURI  string         `gorm:"column:source_uri"`
	Title      string         `gorm:"column:title"`
	Metadata   datatypes.JSON `gorm:"column:metadata;type:jsonb"`
	CreatedAt  time.Time      `gorm:"column:created_at;autoCreateTime"`
}

func (RawDocument) TableName() string {
	return "raw_documents"
}
