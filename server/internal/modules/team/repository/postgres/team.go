package postgres

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"

	"zeus/internal/domain"
	"zeus/internal/modules/team/repository/postgres/mapper"
	"zeus/internal/modules/team/repository/postgres/model"
)

var (
	ErrTeamNotFound       = errors.New("team not found")
	ErrTeamAlreadyExists  = errors.New("team slug already exists")
	ErrMemberNotFound     = errors.New("team member not found")
	ErrMemberExists       = errors.New("user is already a member")
	ErrInvitationNotFound = errors.New("invitation not found")
	ErrJoinLinkNotFound   = errors.New("join link not found")
)

type TeamRepository struct {
	db *gorm.DB
}

func NewTeamRepository(db *gorm.DB) *TeamRepository {
	return &TeamRepository{db: db}
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "sqlstate 23505") ||
		strings.Contains(msg, "duplicate key value violates unique constraint")
}

func (r *TeamRepository) Create(ctx context.Context, team *domain.Team) error {
	m := mapper.TeamToModel(team)
	result := r.db.WithContext(ctx).Create(m)
	if result.Error != nil {
		if isUniqueViolation(result.Error) {
			return ErrTeamAlreadyExists
		}
		return result.Error
	}
	return nil
}

func (r *TeamRepository) GetByID(ctx context.Context, id string) (*domain.Team, error) {
	var m model.Team
	result := r.db.WithContext(ctx).Where("id = ?", id).First(&m)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, ErrTeamNotFound
		}
		return nil, result.Error
	}
	return mapper.TeamToDomain(&m), nil
}

func (r *TeamRepository) GetBySlug(ctx context.Context, slug string) (*domain.Team, error) {
	var m model.Team
	result := r.db.WithContext(ctx).Where("slug = ?", slug).First(&m)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, ErrTeamNotFound
		}
		return nil, result.Error
	}
	return mapper.TeamToDomain(&m), nil
}

func (r *TeamRepository) Update(ctx context.Context, team *domain.Team) error {
	m := mapper.TeamToModel(team)
	result := r.db.WithContext(ctx).Save(m)
	return result.Error
}

func (r *TeamRepository) Delete(ctx context.Context, id string) error {
	result := r.db.WithContext(ctx).Delete(&model.Team{}, "id = ?", id)
	return result.Error
}

func (r *TeamRepository) ListByUserID(ctx context.Context, userID string) ([]*domain.Team, error) {
	var teams []model.Team
	result := r.db.WithContext(ctx).
		Joins("JOIN team_member ON team.id = team_member.team_id").
		Where("team_member.user_id = ?", userID).
		Where("team.status = ?", string(domain.TeamStatusActive)).
		Order("team.created_at DESC").
		Find(&teams)
	if result.Error != nil {
		return nil, result.Error
	}
	domainTeams := make([]*domain.Team, len(teams))
	for i, t := range teams {
		domainTeams[i] = mapper.TeamToDomain(&t)
	}
	return domainTeams, nil
}

func (r *TeamRepository) ExistsBySlug(ctx context.Context, slug string) (bool, error) {
	var count int64
	result := r.db.WithContext(ctx).Model(&model.Team{}).Where("slug = ?", slug).Count(&count)
	return count > 0, result.Error
}

// Member operations

func (r *TeamRepository) AddMember(ctx context.Context, member *domain.TeamMember) error {
	m := mapper.TeamMemberToModel(member)
	result := r.db.WithContext(ctx).Create(m)
	if result.Error != nil {
		if isUniqueViolation(result.Error) {
			return ErrMemberExists
		}
		return result.Error
	}
	return nil
}

func (r *TeamRepository) GetMember(ctx context.Context, teamID, userID string) (*domain.TeamMember, error) {
	var m model.TeamMember
	result := r.db.WithContext(ctx).
		Where("team_id = ? AND user_id = ?", teamID, userID).
		First(&m)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, ErrMemberNotFound
		}
		return nil, result.Error
	}
	return mapper.TeamMemberToDomain(&m), nil
}

func (r *TeamRepository) UpdateMemberRole(ctx context.Context, teamID, userID string, role domain.TeamRole) error {
	result := r.db.WithContext(ctx).
		Model(&model.TeamMember{}).
		Where("team_id = ? AND user_id = ?", teamID, userID).
		Update("role", string(role))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrMemberNotFound
	}
	return nil
}

func (r *TeamRepository) RemoveMember(ctx context.Context, teamID, userID string) error {
	result := r.db.WithContext(ctx).
		Delete(&model.TeamMember{}, "team_id = ? AND user_id = ?", teamID, userID)
	return result.Error
}

func (r *TeamRepository) ListMembers(ctx context.Context, teamID string) ([]*domain.TeamMember, error) {
	var members []model.TeamMember
	result := r.db.WithContext(ctx).
		Where("team_id = ?", teamID).
		Order("joined_at ASC").
		Find(&members)
	if result.Error != nil {
		return nil, result.Error
	}
	domainMembers := make([]*domain.TeamMember, len(members))
	for i, m := range members {
		domainMembers[i] = mapper.TeamMemberToDomain(&m)
	}
	return domainMembers, nil
}

func (r *TeamRepository) IsMember(ctx context.Context, teamID, userID string) (bool, error) {
	var count int64
	result := r.db.WithContext(ctx).
		Model(&model.TeamMember{}).
		Where("team_id = ? AND user_id = ?", teamID, userID).
		Count(&count)
	return count > 0, result.Error
}

// Invitation operations

func (r *TeamRepository) CreateInvitation(ctx context.Context, invitation *domain.TeamInvitation) error {
	m := mapper.InvitationToModel(invitation)
	return r.db.WithContext(ctx).Create(m).Error
}

func (r *TeamRepository) GetInvitation(ctx context.Context, id string) (*domain.TeamInvitation, error) {
	var m model.TeamInvitation
	result := r.db.WithContext(ctx).Where("id = ?", id).First(&m)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, ErrInvitationNotFound
		}
		return nil, result.Error
	}
	return mapper.InvitationToDomain(&m), nil
}

func (r *TeamRepository) GetPendingInvitationByEmail(ctx context.Context, teamID, email string) (*domain.TeamInvitation, error) {
	var m model.TeamInvitation
	result := r.db.WithContext(ctx).
		Where("team_id = ? AND email = ? AND status = ?", teamID, email, string(domain.InvitationStatusPending)).
		First(&m)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, ErrInvitationNotFound
		}
		return nil, result.Error
	}
	return mapper.InvitationToDomain(&m), nil
}

func (r *TeamRepository) UpdateInvitationStatus(ctx context.Context, id string, status domain.InvitationStatus) error {
	result := r.db.WithContext(ctx).
		Model(&model.TeamInvitation{}).
		Where("id = ?", id).
		Update("status", string(status))
	return result.Error
}

func (r *TeamRepository) ListInvitations(ctx context.Context, teamID string) ([]*domain.TeamInvitation, error) {
	var invitations []model.TeamInvitation
	result := r.db.WithContext(ctx).
		Where("team_id = ?", teamID).
		Order("created_at DESC").
		Find(&invitations)
	if result.Error != nil {
		return nil, result.Error
	}
	domainInvitations := make([]*domain.TeamInvitation, len(invitations))
	for i, inv := range invitations {
		domainInvitations[i] = mapper.InvitationToDomain(&inv)
	}
	return domainInvitations, nil
}

func (r *TeamRepository) ListPendingInvitationsByEmail(ctx context.Context, email string) ([]*domain.TeamInvitation, error) {
	var invitations []model.TeamInvitation
	result := r.db.WithContext(ctx).
		Where("email = ? AND status = ?", email, string(domain.InvitationStatusPending)).
		Order("created_at DESC").
		Find(&invitations)
	if result.Error != nil {
		return nil, result.Error
	}
	domainInvitations := make([]*domain.TeamInvitation, len(invitations))
	for i, inv := range invitations {
		domainInvitations[i] = mapper.InvitationToDomain(&inv)
	}
	return domainInvitations, nil
}

func (r *TeamRepository) CreateJoinLink(ctx context.Context, link *domain.TeamJoinLink) error {
	m := mapper.JoinLinkToModel(link)
	return r.db.WithContext(ctx).Create(m).Error
}

func (r *TeamRepository) GetJoinLinkByTokenHash(ctx context.Context, tokenHash string) (*domain.TeamJoinLink, error) {
	var m model.TeamJoinLink
	result := r.db.WithContext(ctx).
		Where("token_hash = ?", tokenHash).
		First(&m)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, ErrJoinLinkNotFound
		}
		return nil, result.Error
	}
	return mapper.JoinLinkToDomain(&m), nil
}

func (r *TeamRepository) RevokeActiveJoinLinksByRole(ctx context.Context, teamID string, role domain.TeamRole, now time.Time) error {
	result := r.db.WithContext(ctx).
		Model(&model.TeamJoinLink{}).
		Where("team_id = ? AND role = ? AND revoked_at IS NULL AND expires_at > ?", teamID, string(role), now).
		Update("revoked_at", now)
	return result.Error
}

func (r *TeamRepository) TouchJoinLinkUsage(ctx context.Context, id string, usedAt time.Time) error {
	result := r.db.WithContext(ctx).
		Model(&model.TeamJoinLink{}).
		Where("id = ?", id).
		Update("last_used_at", usedAt)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrJoinLinkNotFound
	}
	return nil
}
