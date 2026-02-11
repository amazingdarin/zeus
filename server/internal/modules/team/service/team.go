package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"time"

	"github.com/google/uuid"

	"zeus/internal/domain"
	teamrepo "zeus/internal/modules/team/repository"
	teampostgres "zeus/internal/modules/team/repository/postgres"
	userrepo "zeus/internal/modules/user/repository"
	userpostgres "zeus/internal/modules/user/repository/postgres"
)

var (
	ErrTeamNotFound       = errors.New("team not found")
	ErrTeamSlugExists     = errors.New("team slug already exists")
	ErrNotTeamMember      = errors.New("user is not a member of this team")
	ErrNotAuthorized      = errors.New("not authorized to perform this action")
	ErrCannotRemoveOwner  = errors.New("cannot remove team owner")
	ErrMemberExists       = errors.New("user is already a member")
	ErrInvitationNotFound = errors.New("invitation not found")
	ErrInvitationExpired  = errors.New("invitation has expired")
	ErrUserNotFound       = errors.New("user not found")
	ErrJoinLinkNotFound   = errors.New("join link not found")
	ErrJoinLinkExpired    = errors.New("join link has expired")
)

const joinLinkTTL = 7 * 24 * time.Hour

// TeamService handles team operations
type TeamService struct {
	teamRepo teamrepo.TeamRepository
	userRepo userrepo.UserRepository
}

// NewTeamService creates a new team service
func NewTeamService(teamRepo teamrepo.TeamRepository, userRepo userrepo.UserRepository) *TeamService {
	return &TeamService{
		teamRepo: teamRepo,
		userRepo: userRepo,
	}
}

// CreateInput represents team creation data
type CreateInput struct {
	Name        string
	Slug        string
	Description string
}

// Create creates a new team
func (s *TeamService) Create(ctx context.Context, userID string, input CreateInput) (*domain.Team, error) {
	// Check if slug exists
	exists, err := s.teamRepo.ExistsBySlug(ctx, input.Slug)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, ErrTeamSlugExists
	}

	now := time.Now()
	team := &domain.Team{
		ID:          uuid.New().String(),
		Slug:        input.Slug,
		Name:        input.Name,
		Description: input.Description,
		OwnerID:     userID,
		Status:      domain.TeamStatusActive,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if err := team.Validate(); err != nil {
		return nil, err
	}

	if err := s.teamRepo.Create(ctx, team); err != nil {
		if errors.Is(err, teampostgres.ErrTeamAlreadyExists) {
			return nil, ErrTeamSlugExists
		}
		return nil, err
	}

	// Add creator as owner member
	member := &domain.TeamMember{
		ID:        uuid.New().String(),
		TeamID:    team.ID,
		UserID:    userID,
		Role:      domain.TeamRoleOwner,
		JoinedAt:  now,
		CreatedAt: now,
	}
	if err := s.teamRepo.AddMember(ctx, member); err != nil {
		return nil, err
	}

	return team, nil
}

// GetBySlug returns a team by slug
func (s *TeamService) GetBySlug(ctx context.Context, slug string) (*domain.Team, error) {
	team, err := s.teamRepo.GetBySlug(ctx, slug)
	if err != nil {
		if errors.Is(err, teampostgres.ErrTeamNotFound) {
			return nil, ErrTeamNotFound
		}
		return nil, err
	}
	return team, nil
}

// GetByID returns a team by ID
func (s *TeamService) GetByID(ctx context.Context, id string) (*domain.Team, error) {
	team, err := s.teamRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, teampostgres.ErrTeamNotFound) {
			return nil, ErrTeamNotFound
		}
		return nil, err
	}
	return team, nil
}

// UpdateInput represents team update data
type UpdateInput struct {
	Name        *string
	Description *string
	AvatarURL   *string
}

// Update updates a team
func (s *TeamService) Update(ctx context.Context, userID, teamSlug string, input UpdateInput) (*domain.Team, error) {
	team, err := s.teamRepo.GetBySlug(ctx, teamSlug)
	if err != nil {
		if errors.Is(err, teampostgres.ErrTeamNotFound) {
			return nil, ErrTeamNotFound
		}
		return nil, err
	}

	// Check authorization
	member, err := s.teamRepo.GetMember(ctx, team.ID, userID)
	if err != nil {
		if errors.Is(err, teampostgres.ErrMemberNotFound) {
			return nil, ErrNotTeamMember
		}
		return nil, err
	}
	if !member.Role.CanManageTeam() {
		return nil, ErrNotAuthorized
	}

	if input.Name != nil {
		team.Name = *input.Name
	}
	if input.Description != nil {
		team.Description = *input.Description
	}
	if input.AvatarURL != nil {
		team.AvatarURL = *input.AvatarURL
	}
	team.UpdatedAt = time.Now()

	if err := s.teamRepo.Update(ctx, team); err != nil {
		return nil, err
	}

	return team, nil
}

// Delete deletes a team
func (s *TeamService) Delete(ctx context.Context, userID, teamSlug string) error {
	team, err := s.teamRepo.GetBySlug(ctx, teamSlug)
	if err != nil {
		if errors.Is(err, teampostgres.ErrTeamNotFound) {
			return ErrTeamNotFound
		}
		return err
	}

	// Check authorization - only owner can delete
	member, err := s.teamRepo.GetMember(ctx, team.ID, userID)
	if err != nil {
		if errors.Is(err, teampostgres.ErrMemberNotFound) {
			return ErrNotTeamMember
		}
		return err
	}
	if !member.Role.CanDeleteTeam() {
		return ErrNotAuthorized
	}

	return s.teamRepo.Delete(ctx, team.ID)
}

// ListByUser returns teams for a user
func (s *TeamService) ListByUser(ctx context.Context, userID string) ([]*domain.Team, error) {
	return s.teamRepo.ListByUserID(ctx, userID)
}

// GetUserRole returns a user's role in a team
func (s *TeamService) GetUserRole(ctx context.Context, teamSlug, userID string) (domain.TeamRole, error) {
	team, err := s.teamRepo.GetBySlug(ctx, teamSlug)
	if err != nil {
		if errors.Is(err, teampostgres.ErrTeamNotFound) {
			return "", ErrTeamNotFound
		}
		return "", err
	}

	member, err := s.teamRepo.GetMember(ctx, team.ID, userID)
	if err != nil {
		if errors.Is(err, teampostgres.ErrMemberNotFound) {
			return "", ErrNotTeamMember
		}
		return "", err
	}

	return member.Role, nil
}

// Member operations

// ListMembers returns all members of a team
func (s *TeamService) ListMembers(ctx context.Context, userID, teamSlug string) ([]*domain.TeamMemberWithUser, error) {
	team, err := s.teamRepo.GetBySlug(ctx, teamSlug)
	if err != nil {
		if errors.Is(err, teampostgres.ErrTeamNotFound) {
			return nil, ErrTeamNotFound
		}
		return nil, err
	}

	// Check if user is a member
	isMember, err := s.teamRepo.IsMember(ctx, team.ID, userID)
	if err != nil {
		return nil, err
	}
	if !isMember {
		return nil, ErrNotTeamMember
	}

	members, err := s.teamRepo.ListMembers(ctx, team.ID)
	if err != nil {
		return nil, err
	}

	// Fetch user info for each member
	result := make([]*domain.TeamMemberWithUser, len(members))
	for i, m := range members {
		user, err := s.userRepo.GetByID(ctx, m.UserID)
		if err != nil {
			continue // Skip users that can't be found
		}
		result[i] = &domain.TeamMemberWithUser{
			TeamMember: *m,
			User:       user.ToPublicInfo(),
		}
	}

	return result, nil
}

// AddMemberInput represents add member data
type AddMemberInput struct {
	UserID string
	Role   domain.TeamRole
}

// AddMember adds a user to a team
func (s *TeamService) AddMember(ctx context.Context, actorID, teamSlug string, input AddMemberInput) error {
	team, err := s.teamRepo.GetBySlug(ctx, teamSlug)
	if err != nil {
		if errors.Is(err, teampostgres.ErrTeamNotFound) {
			return ErrTeamNotFound
		}
		return err
	}

	// Check authorization
	member, err := s.teamRepo.GetMember(ctx, team.ID, actorID)
	if err != nil {
		if errors.Is(err, teampostgres.ErrMemberNotFound) {
			return ErrNotTeamMember
		}
		return err
	}
	if !member.Role.CanManageMembers() {
		return ErrNotAuthorized
	}

	// Cannot add as owner
	if input.Role == domain.TeamRoleOwner {
		return ErrNotAuthorized
	}

	now := time.Now()
	newMember := &domain.TeamMember{
		ID:        uuid.New().String(),
		TeamID:    team.ID,
		UserID:    input.UserID,
		Role:      input.Role,
		JoinedAt:  now,
		CreatedAt: now,
	}

	if err := s.teamRepo.AddMember(ctx, newMember); err != nil {
		if errors.Is(err, teampostgres.ErrMemberExists) {
			return ErrMemberExists
		}
		return err
	}

	return nil
}

// UpdateMemberRole updates a member's role
func (s *TeamService) UpdateMemberRole(ctx context.Context, actorID, teamSlug, targetUserID string, role domain.TeamRole) error {
	team, err := s.teamRepo.GetBySlug(ctx, teamSlug)
	if err != nil {
		if errors.Is(err, teampostgres.ErrTeamNotFound) {
			return ErrTeamNotFound
		}
		return err
	}

	// Check authorization
	actorMember, err := s.teamRepo.GetMember(ctx, team.ID, actorID)
	if err != nil {
		if errors.Is(err, teampostgres.ErrMemberNotFound) {
			return ErrNotTeamMember
		}
		return err
	}
	if !actorMember.Role.CanManageMembers() {
		return ErrNotAuthorized
	}

	// Cannot change to owner
	if role == domain.TeamRoleOwner {
		return ErrNotAuthorized
	}

	// Cannot change owner's role
	targetMember, err := s.teamRepo.GetMember(ctx, team.ID, targetUserID)
	if err != nil {
		if errors.Is(err, teampostgres.ErrMemberNotFound) {
			return ErrNotTeamMember
		}
		return err
	}
	if targetMember.Role == domain.TeamRoleOwner {
		return ErrCannotRemoveOwner
	}

	return s.teamRepo.UpdateMemberRole(ctx, team.ID, targetUserID, role)
}

// RemoveMember removes a member from a team
func (s *TeamService) RemoveMember(ctx context.Context, actorID, teamSlug, targetUserID string) error {
	team, err := s.teamRepo.GetBySlug(ctx, teamSlug)
	if err != nil {
		if errors.Is(err, teampostgres.ErrTeamNotFound) {
			return ErrTeamNotFound
		}
		return err
	}

	// Check if actor can remove members
	actorMember, err := s.teamRepo.GetMember(ctx, team.ID, actorID)
	if err != nil {
		if errors.Is(err, teampostgres.ErrMemberNotFound) {
			return ErrNotTeamMember
		}
		return err
	}

	// Can remove self, or admin/owner can remove others
	if actorID != targetUserID && !actorMember.Role.CanManageMembers() {
		return ErrNotAuthorized
	}

	// Cannot remove owner
	targetMember, err := s.teamRepo.GetMember(ctx, team.ID, targetUserID)
	if err != nil {
		if errors.Is(err, teampostgres.ErrMemberNotFound) {
			return ErrNotTeamMember
		}
		return err
	}
	if targetMember.Role == domain.TeamRoleOwner {
		return ErrCannotRemoveOwner
	}

	return s.teamRepo.RemoveMember(ctx, team.ID, targetUserID)
}

// Invitation operations

// InviteInput represents invitation data
type InviteInput struct {
	Email string
	Role  domain.TeamRole
}

// InviteMember creates an invitation
func (s *TeamService) InviteMember(ctx context.Context, actorID, teamSlug string, input InviteInput) (*domain.TeamInvitation, error) {
	team, err := s.teamRepo.GetBySlug(ctx, teamSlug)
	if err != nil {
		if errors.Is(err, teampostgres.ErrTeamNotFound) {
			return nil, ErrTeamNotFound
		}
		return nil, err
	}

	// Check authorization
	member, err := s.teamRepo.GetMember(ctx, team.ID, actorID)
	if err != nil {
		if errors.Is(err, teampostgres.ErrMemberNotFound) {
			return nil, ErrNotTeamMember
		}
		return nil, err
	}
	if !member.Role.CanManageMembers() {
		return nil, ErrNotAuthorized
	}

	// Cannot invite as owner
	if input.Role == domain.TeamRoleOwner {
		return nil, ErrNotAuthorized
	}

	// Check if user with this email is already a member
	user, err := s.userRepo.GetByEmail(ctx, input.Email)
	if err == nil {
		// User exists, check if already a member
		isMember, _ := s.teamRepo.IsMember(ctx, team.ID, user.ID)
		if isMember {
			return nil, ErrMemberExists
		}
	}

	now := time.Now()
	invitation := &domain.TeamInvitation{
		ID:        uuid.New().String(),
		TeamID:    team.ID,
		Email:     input.Email,
		Role:      input.Role,
		InvitedBy: actorID,
		Status:    domain.InvitationStatusPending,
		ExpiresAt: now.Add(7 * 24 * time.Hour), // 7 days
		CreatedAt: now,
	}

	if err := invitation.Validate(); err != nil {
		return nil, err
	}

	if err := s.teamRepo.CreateInvitation(ctx, invitation); err != nil {
		return nil, err
	}

	return invitation, nil
}

// ListInvitations returns all invitations for a team
func (s *TeamService) ListInvitations(ctx context.Context, userID, teamSlug string) ([]*domain.TeamInvitation, error) {
	team, err := s.teamRepo.GetBySlug(ctx, teamSlug)
	if err != nil {
		if errors.Is(err, teampostgres.ErrTeamNotFound) {
			return nil, ErrTeamNotFound
		}
		return nil, err
	}

	// Check if user is a member
	member, err := s.teamRepo.GetMember(ctx, team.ID, userID)
	if err != nil {
		if errors.Is(err, teampostgres.ErrMemberNotFound) {
			return nil, ErrNotTeamMember
		}
		return nil, err
	}
	if !member.Role.CanManageMembers() {
		return nil, ErrNotAuthorized
	}

	return s.teamRepo.ListInvitations(ctx, team.ID)
}

// AcceptInvitation accepts an invitation
func (s *TeamService) AcceptInvitation(ctx context.Context, userID, invitationID string) error {
	invitation, err := s.teamRepo.GetInvitation(ctx, invitationID)
	if err != nil {
		if errors.Is(err, teampostgres.ErrInvitationNotFound) {
			return ErrInvitationNotFound
		}
		return err
	}

	// Check if invitation is still valid
	if invitation.Status != domain.InvitationStatusPending {
		return ErrInvitationNotFound
	}
	if invitation.IsExpired() {
		_ = s.teamRepo.UpdateInvitationStatus(ctx, invitationID, domain.InvitationStatusExpired)
		return ErrInvitationExpired
	}

	// Verify user email matches invitation
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		if errors.Is(err, userpostgres.ErrUserNotFound) {
			return ErrUserNotFound
		}
		return err
	}
	if user.Email != invitation.Email {
		return ErrNotAuthorized
	}

	// Add user to team
	now := time.Now()
	member := &domain.TeamMember{
		ID:        uuid.New().String(),
		TeamID:    invitation.TeamID,
		UserID:    userID,
		Role:      invitation.Role,
		JoinedAt:  now,
		CreatedAt: now,
	}

	if err := s.teamRepo.AddMember(ctx, member); err != nil {
		if errors.Is(err, teampostgres.ErrMemberExists) {
			// Already a member, mark invitation as accepted anyway
			_ = s.teamRepo.UpdateInvitationStatus(ctx, invitationID, domain.InvitationStatusAccepted)
			return nil
		}
		return err
	}

	// Mark invitation as accepted
	return s.teamRepo.UpdateInvitationStatus(ctx, invitationID, domain.InvitationStatusAccepted)
}

// GetPendingInvitations returns pending invitations for a user
func (s *TeamService) GetPendingInvitations(ctx context.Context, userID string) ([]*domain.TeamInvitation, error) {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.teamRepo.ListPendingInvitationsByEmail(ctx, user.Email)
}

// IsMember checks if a user is a member of a team
func (s *TeamService) IsMember(ctx context.Context, teamSlug, userID string) (bool, error) {
	team, err := s.teamRepo.GetBySlug(ctx, teamSlug)
	if err != nil {
		if errors.Is(err, teampostgres.ErrTeamNotFound) {
			return false, ErrTeamNotFound
		}
		return false, err
	}
	return s.teamRepo.IsMember(ctx, team.ID, userID)
}

type CreateJoinLinkInput struct {
	Role domain.TeamRole
}

type JoinLinkResult struct {
	Link     *domain.TeamJoinLink
	Token    string
	TeamSlug string
}

func (s *TeamService) CreateJoinLink(ctx context.Context, actorID, teamSlug string, input CreateJoinLinkInput) (*JoinLinkResult, error) {
	team, err := s.teamRepo.GetBySlug(ctx, teamSlug)
	if err != nil {
		if errors.Is(err, teampostgres.ErrTeamNotFound) {
			return nil, ErrTeamNotFound
		}
		return nil, err
	}

	member, err := s.teamRepo.GetMember(ctx, team.ID, actorID)
	if err != nil {
		if errors.Is(err, teampostgres.ErrMemberNotFound) {
			return nil, ErrNotTeamMember
		}
		return nil, err
	}
	if !member.Role.CanManageMembers() {
		return nil, ErrNotAuthorized
	}

	role := input.Role
	if role == "" {
		role = domain.TeamRoleMember
	}
	if role == domain.TeamRoleOwner || !role.IsValid() {
		return nil, ErrNotAuthorized
	}

	now := time.Now()
	if err := s.teamRepo.RevokeActiveJoinLinksByRole(ctx, team.ID, role, now); err != nil {
		return nil, err
	}

	token, err := newJoinToken()
	if err != nil {
		return nil, err
	}
	link := &domain.TeamJoinLink{
		ID:        uuid.New().String(),
		TeamID:    team.ID,
		TokenHash: hashJoinToken(token),
		Role:      role,
		CreatedBy: actorID,
		ExpiresAt: now.Add(joinLinkTTL),
		CreatedAt: now,
	}
	if err := link.Validate(); err != nil {
		return nil, err
	}
	if err := s.teamRepo.CreateJoinLink(ctx, link); err != nil {
		return nil, err
	}

	return &JoinLinkResult{Link: link, Token: token, TeamSlug: team.Slug}, nil
}

type JoinLinkPreview struct {
	TeamName  string
	TeamSlug  string
	Role      domain.TeamRole
	ExpiresAt time.Time
}

func (s *TeamService) GetJoinLinkPreview(ctx context.Context, token string) (*JoinLinkPreview, error) {
	link, team, err := s.resolveJoinLink(ctx, token)
	if err != nil {
		return nil, err
	}
	return &JoinLinkPreview{
		TeamName:  team.Name,
		TeamSlug:  team.Slug,
		Role:      link.Role,
		ExpiresAt: link.ExpiresAt,
	}, nil
}

func (s *TeamService) JoinByLink(ctx context.Context, userID, token string) (*domain.Team, error) {
	link, team, err := s.resolveJoinLink(ctx, token)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	member := &domain.TeamMember{
		ID:        uuid.New().String(),
		TeamID:    team.ID,
		UserID:    userID,
		Role:      link.Role,
		JoinedAt:  now,
		CreatedAt: now,
	}
	if err := s.teamRepo.AddMember(ctx, member); err != nil {
		if !errors.Is(err, teampostgres.ErrMemberExists) {
			return nil, err
		}
	}

	if err := s.teamRepo.TouchJoinLinkUsage(ctx, link.ID, now); err != nil && !errors.Is(err, teampostgres.ErrJoinLinkNotFound) {
		return nil, err
	}

	return team, nil
}

func (s *TeamService) resolveJoinLink(ctx context.Context, token string) (*domain.TeamJoinLink, *domain.Team, error) {
	tokenHash := hashJoinToken(token)
	link, err := s.teamRepo.GetJoinLinkByTokenHash(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, teampostgres.ErrJoinLinkNotFound) {
			return nil, nil, ErrJoinLinkNotFound
		}
		return nil, nil, err
	}
	if link.RevokedAt != nil || link.IsExpired() {
		return nil, nil, ErrJoinLinkExpired
	}

	team, err := s.teamRepo.GetByID(ctx, link.TeamID)
	if err != nil {
		if errors.Is(err, teampostgres.ErrTeamNotFound) {
			return nil, nil, ErrTeamNotFound
		}
		return nil, nil, err
	}
	if team.Status != domain.TeamStatusActive {
		return nil, nil, ErrTeamNotFound
	}
	return link, team, nil
}

func newJoinToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func hashJoinToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
