package model

import "time"

type Project struct {
	ID          string    `gorm:"column:id;primaryKey"`
	Key         string    `gorm:"column:key;not null;unique"`
	Name        string    `gorm:"column:name;not null"`
	Description string    `gorm:"column:description"`
	RepoURL     string    `gorm:"column:repo_url;not null"`
	RepoBaseURL string    `gorm:"column:repo_base_url;not null"`
	RepoName    string    `gorm:"column:repo_name;not null"`
	// Ownership fields
	OwnerType   string    `gorm:"column:owner_type;not null;default:user"`
	OwnerID     string    `gorm:"column:owner_id;not null"`
	Visibility  string    `gorm:"column:visibility;not null;default:private"`
	Status      string    `gorm:"column:status;not null;default:active"`
	CreatedAt   time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt   time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (Project) TableName() string {
	return "project"
}
