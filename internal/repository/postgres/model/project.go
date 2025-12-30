package model

import "time"

type Project struct {
	ID          string    `gorm:"column:id;primaryKey"`
	Key         string    `gorm:"column:key;not null;unique"`
	Name        string    `gorm:"column:name;not null"`
	Description string    `gorm:"column:description"`
	Status      string    `gorm:"column:status;not null"`
	CreatedAt   time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt   time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (Project) TableName() string {
	return "project"
}
