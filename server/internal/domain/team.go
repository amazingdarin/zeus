package domain

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

type TeamStatus string

const (
	TeamStatusActive   TeamStatus = "active"
	TeamStatusArchived TeamStatus = "archived"
)

func (s TeamStatus) IsValid() bool {
	switch s {
	case TeamStatusActive, TeamStatusArchived:
		return true
	default:
		return false
	}
}

type TeamRole string

const (
	TeamRoleOwner  TeamRole = "owner"
	TeamRoleAdmin  TeamRole = "admin"
	TeamRoleMember TeamRole = "member"
	TeamRoleViewer TeamRole = "viewer"
)

func (r TeamRole) IsValid() bool {
	switch r {
	case TeamRoleOwner, TeamRoleAdmin, TeamRoleMember, TeamRoleViewer:
		return true
	default:
		return false
	}
}

// CanManageMembers returns true if this role can manage team members
func (r TeamRole) CanManageMembers() bool {
	return r == TeamRoleOwner || r == TeamRoleAdmin
}

// CanManageTeam returns true if this role can modify team settings
func (r TeamRole) CanManageTeam() bool {
	return r == TeamRoleOwner || r == TeamRoleAdmin
}

// CanDeleteTeam returns true if this role can delete the team
func (r TeamRole) CanDeleteTeam() bool {
	return r == TeamRoleOwner
}

// CanCreateProject returns true if this role can create projects
func (r TeamRole) CanCreateProject() bool {
	return r == TeamRoleOwner || r == TeamRoleAdmin || r == TeamRoleMember
}

// CanDeleteProject returns true if this role can delete projects
func (r TeamRole) CanDeleteProject() bool {
	return r == TeamRoleOwner || r == TeamRoleAdmin
}

type Team struct {
	ID          string
	Slug        string
	Name        string
	Description string
	AvatarURL   string
	OwnerID     string
	Status      TeamStatus
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

var slugRegex = regexp.MustCompile(`^[a-z][a-z0-9-]{2,39}$`)

func (t Team) Validate() error {
	if strings.TrimSpace(t.ID) == "" {
		return fmt.Errorf("team id is required")
	}
	if strings.TrimSpace(t.Slug) == "" {
		return fmt.Errorf("team slug is required")
	}
	if !slugRegex.MatchString(t.Slug) {
		return fmt.Errorf("team slug must be 3-40 characters, start with a lowercase letter, and contain only lowercase letters, numbers, or hyphens")
	}
	if strings.TrimSpace(t.Name) == "" {
		return fmt.Errorf("team name is required")
	}
	if len(t.Name) > 100 {
		return fmt.Errorf("team name must be at most 100 characters")
	}
	if strings.TrimSpace(t.OwnerID) == "" {
		return fmt.Errorf("team owner id is required")
	}
	if t.Status == "" {
		return fmt.Errorf("team status is required")
	}
	if !t.Status.IsValid() {
		return fmt.Errorf("invalid team status: %s", t.Status)
	}
	return nil
}

type TeamMember struct {
	ID        string
	TeamID    string
	UserID    string
	Role      TeamRole
	JoinedAt  time.Time
	CreatedAt time.Time
}

func (m TeamMember) Validate() error {
	if strings.TrimSpace(m.ID) == "" {
		return fmt.Errorf("team member id is required")
	}
	if strings.TrimSpace(m.TeamID) == "" {
		return fmt.Errorf("team id is required")
	}
	if strings.TrimSpace(m.UserID) == "" {
		return fmt.Errorf("user id is required")
	}
	if m.Role == "" {
		return fmt.Errorf("role is required")
	}
	if !m.Role.IsValid() {
		return fmt.Errorf("invalid team role: %s", m.Role)
	}
	return nil
}

// TeamMemberWithUser combines member info with user info
type TeamMemberWithUser struct {
	TeamMember
	User UserPublicInfo
}

type InvitationStatus string

const (
	InvitationStatusPending   InvitationStatus = "pending"
	InvitationStatusAccepted  InvitationStatus = "accepted"
	InvitationStatusExpired   InvitationStatus = "expired"
	InvitationStatusCancelled InvitationStatus = "cancelled"
)

func (s InvitationStatus) IsValid() bool {
	switch s {
	case InvitationStatusPending, InvitationStatusAccepted, InvitationStatusExpired, InvitationStatusCancelled:
		return true
	default:
		return false
	}
}

type TeamInvitation struct {
	ID        string
	TeamID    string
	Email     string
	Role      TeamRole
	InvitedBy string
	Status    InvitationStatus
	ExpiresAt time.Time
	CreatedAt time.Time
}

func (i TeamInvitation) Validate() error {
	if strings.TrimSpace(i.ID) == "" {
		return fmt.Errorf("invitation id is required")
	}
	if strings.TrimSpace(i.TeamID) == "" {
		return fmt.Errorf("team id is required")
	}
	if strings.TrimSpace(i.Email) == "" {
		return fmt.Errorf("email is required")
	}
	if !emailRegex.MatchString(i.Email) {
		return fmt.Errorf("invalid email format")
	}
	if i.Role == "" {
		return fmt.Errorf("role is required")
	}
	if !i.Role.IsValid() {
		return fmt.Errorf("invalid team role: %s", i.Role)
	}
	if i.Role == TeamRoleOwner {
		return fmt.Errorf("cannot invite as owner")
	}
	if strings.TrimSpace(i.InvitedBy) == "" {
		return fmt.Errorf("invited by is required")
	}
	if i.Status == "" {
		return fmt.Errorf("status is required")
	}
	if !i.Status.IsValid() {
		return fmt.Errorf("invalid invitation status: %s", i.Status)
	}
	return nil
}

func (i TeamInvitation) IsExpired() bool {
	return time.Now().After(i.ExpiresAt)
}

type TeamJoinLink struct {
	ID         string
	TeamID     string
	TokenHash  string
	Role       TeamRole
	CreatedBy  string
	ExpiresAt  time.Time
	RevokedAt  *time.Time
	LastUsedAt *time.Time
	CreatedAt  time.Time
}

func (l TeamJoinLink) Validate() error {
	if strings.TrimSpace(l.ID) == "" {
		return fmt.Errorf("join link id is required")
	}
	if strings.TrimSpace(l.TeamID) == "" {
		return fmt.Errorf("team id is required")
	}
	if strings.TrimSpace(l.TokenHash) == "" {
		return fmt.Errorf("token hash is required")
	}
	if l.Role == "" {
		return fmt.Errorf("role is required")
	}
	if !l.Role.IsValid() {
		return fmt.Errorf("invalid team role: %s", l.Role)
	}
	if l.Role == TeamRoleOwner {
		return fmt.Errorf("cannot invite as owner")
	}
	if strings.TrimSpace(l.CreatedBy) == "" {
		return fmt.Errorf("created by is required")
	}
	if l.ExpiresAt.IsZero() {
		return fmt.Errorf("expires at is required")
	}
	return nil
}

func (l TeamJoinLink) IsExpired() bool {
	return time.Now().After(l.ExpiresAt)
}
