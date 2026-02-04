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

type OwnerType string

const (
	OwnerTypeUser OwnerType = "user"
	OwnerTypeTeam OwnerType = "team"
)

func (t OwnerType) IsValid() bool {
	switch t {
	case OwnerTypeUser, OwnerTypeTeam:
		return true
	default:
		return false
	}
}

type ProjectVisibility string

const (
	ProjectVisibilityPrivate ProjectVisibility = "private"
	ProjectVisibilityTeam    ProjectVisibility = "team"
	ProjectVisibilityPublic  ProjectVisibility = "public"
)

func (v ProjectVisibility) IsValid() bool {
	switch v {
	case ProjectVisibilityPrivate, ProjectVisibilityTeam, ProjectVisibilityPublic:
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
	RepoBaseURL string
	RepoName    string
	// Ownership fields
	OwnerType   OwnerType
	OwnerID     string
	Visibility  ProjectVisibility
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
	if strings.TrimSpace(p.RepoBaseURL) == "" {
		return fmt.Errorf("project repo base url is required")
	}
	if strings.TrimSpace(p.RepoName) == "" {
		return fmt.Errorf("project repo name is required")
	}
	expected := strings.TrimRight(strings.TrimSpace(p.RepoBaseURL), "/") + "/" +
		strings.TrimLeft(strings.TrimSpace(p.RepoName), "/")
	if strings.TrimSpace(p.RepoURL) != expected {
		return fmt.Errorf("project repo url mismatch")
	}
	if p.Status == "" {
		return fmt.Errorf("project status is required")
	}
	if !p.Status.IsValid() {
		return fmt.Errorf("invalid project status: %s", p.Status)
	}
	// Ownership validation
	if p.OwnerType == "" {
		return fmt.Errorf("project owner type is required")
	}
	if !p.OwnerType.IsValid() {
		return fmt.Errorf("invalid owner type: %s", p.OwnerType)
	}
	if strings.TrimSpace(p.OwnerID) == "" {
		return fmt.Errorf("project owner id is required")
	}
	if p.Visibility == "" {
		return fmt.Errorf("project visibility is required")
	}
	if !p.Visibility.IsValid() {
		return fmt.Errorf("invalid visibility: %s", p.Visibility)
	}
	return nil
}

// CanAccess checks if a user can access this project
func (p Project) CanAccess(userID string, userTeamIDs []string) bool {
	// Public projects are accessible to everyone
	if p.Visibility == ProjectVisibilityPublic {
		return true
	}
	// Private user project - only owner can access
	if p.OwnerType == OwnerTypeUser {
		return p.OwnerID == userID
	}
	// Team project
	if p.OwnerType == OwnerTypeTeam {
		// Team visibility - any team member can access
		if p.Visibility == ProjectVisibilityTeam || p.Visibility == ProjectVisibilityPrivate {
			for _, teamID := range userTeamIDs {
				if teamID == p.OwnerID {
					return true
				}
			}
		}
	}
	return false
}
