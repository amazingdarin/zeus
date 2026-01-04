package domain

import (
	"fmt"
	"strings"
	"time"
)

type ProjectStatus string

const (
	ProjectStatusCreating ProjectStatus = "creating"
	ProjectStatusActive   ProjectStatus = "active"
	ProjectStatusFailed   ProjectStatus = "failed"
	ProjectStatusArchived ProjectStatus = "archived"
)

func (s ProjectStatus) IsValid() bool {
	switch s {
	case ProjectStatusCreating, ProjectStatusActive, ProjectStatusFailed, ProjectStatusArchived:
		return true
	default:
		return false
	}
}

type Project struct {
	ID          string
	Key         string
	Name        string
	Description string
	RepoURL     string
	RepoName    string
	Status      ProjectStatus
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (p Project) Validate() error {
	if strings.TrimSpace(p.ID) == "" {
		return fmt.Errorf("project id is required")
	}
	if strings.TrimSpace(p.Key) == "" {
		return fmt.Errorf("project key is required")
	}
	if strings.TrimSpace(p.Name) == "" {
		return fmt.Errorf("project name is required")
	}
	if strings.TrimSpace(p.RepoURL) == "" {
		return fmt.Errorf("project repo url is required")
	}
	if strings.TrimSpace(p.RepoName) == "" {
		return fmt.Errorf("project repo name is required")
	}
	if p.Status == "" {
		return fmt.Errorf("project status is required")
	}
	if !p.Status.IsValid() {
		return fmt.Errorf("invalid project status: %s", p.Status)
	}
	return nil
}
