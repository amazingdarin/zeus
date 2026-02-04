package repository

import (
	"context"

	"zeus/internal/domain"
)

// TeamRepository defines the interface for team data access
type TeamRepository interface {
	// Team CRUD
	Create(ctx context.Context, team *domain.Team) error
	GetByID(ctx context.Context, id string) (*domain.Team, error)
	GetBySlug(ctx context.Context, slug string) (*domain.Team, error)
	Update(ctx context.Context, team *domain.Team) error
	Delete(ctx context.Context, id string) error
	ListByUserID(ctx context.Context, userID string) ([]*domain.Team, error)
	ExistsBySlug(ctx context.Context, slug string) (bool, error)

	// Member operations
	AddMember(ctx context.Context, member *domain.TeamMember) error
	GetMember(ctx context.Context, teamID, userID string) (*domain.TeamMember, error)
	UpdateMemberRole(ctx context.Context, teamID, userID string, role domain.TeamRole) error
	RemoveMember(ctx context.Context, teamID, userID string) error
	ListMembers(ctx context.Context, teamID string) ([]*domain.TeamMember, error)
	IsMember(ctx context.Context, teamID, userID string) (bool, error)

	// Invitation operations
	CreateInvitation(ctx context.Context, invitation *domain.TeamInvitation) error
	GetInvitation(ctx context.Context, id string) (*domain.TeamInvitation, error)
	GetPendingInvitationByEmail(ctx context.Context, teamID, email string) (*domain.TeamInvitation, error)
	UpdateInvitationStatus(ctx context.Context, id string, status domain.InvitationStatus) error
	ListInvitations(ctx context.Context, teamID string) ([]*domain.TeamInvitation, error)
	ListPendingInvitationsByEmail(ctx context.Context, email string) ([]*domain.TeamInvitation, error)
}
