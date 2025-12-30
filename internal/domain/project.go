package domain

import (
	"fmt"
	"strings"
	"time"
)

type ProjectStatus string

const (
	ProjectStatusActive   ProjectStatus = "active"
	ProjectStatusArchived ProjectStatus = "archived"
)

func (s ProjectStatus) IsValid() bool {
	switch s {
	case ProjectStatusActive, ProjectStatusArchived:
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
	if p.Status == "" {
		return fmt.Errorf("project status is required")
	}
	if !p.Status.IsValid() {
		return fmt.Errorf("invalid project status: %s", p.Status)
	}
	return nil
}
