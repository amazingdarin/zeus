package model

import (
	"time"
)

type Document struct {
	ID        string `gorm:"column:id;primaryKey"`
	ProjectID string `gorm:"column:project_id;not null"`

	Type        string `gorm:"column:type;not null"`
	Title       string `gorm:"column:title"`
	Description string `gorm:"column:description"`
	Status      string `gorm:"column:status;not null"`

	Path     string `gorm:"column:path;not null"`
	Order    int    `gorm:"column:order;not null"`
	ParentID string `gorm:"column:parent_id;not null"`

	StorageObjectID string    `gorm:"column:storage_object_id;not null"`
	CreatedAt       time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt       time.Time `gorm:"column:updated_at;autoUpdateTime"`

	StorageObject *StorageObject `gorm:"foreignKey:StorageObjectID;references:ID"`
}

func (Document) TableName() string {
	return "document"
}
