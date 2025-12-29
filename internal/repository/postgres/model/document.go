package model

import (
	"time"
)

type Document struct {
	ID              string    `gorm:"primaryKey"`
	Type            string    `gorm:"column:type;not null"`
	Title           string    `gorm:"column:title"`
	Description     string    `gorm:"column:description"`
	Status          string    `gorm:"column:status"`
	StorageObjectID string    `gorm:"column:storage_object_id;not null"`
	CreatedAt       time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt       time.Time `gorm:"column:created_at;autoUpdateTime"`
}

func (Document) TableName() string {
	return "document"
}
