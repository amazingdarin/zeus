package mapper

import (
	"zeus/internal/domain"
	"zeus/internal/modules/team/repository/postgres/model"
)

func TeamToDomain(m *model.Team) *domain.Team {
	if m == nil {
		return nil
	}
	return &domain.Team{
		ID:          m.ID,
		Slug:        m.Slug,
		Name:        m.Name,
		Description: m.Description,
		AvatarURL:   m.AvatarURL,
		OwnerID:     m.OwnerID,
		Status:      domain.TeamStatus(m.Status),
		CreatedAt:   m.CreatedAt,
		UpdatedAt:   m.UpdatedAt,
	}
}

func TeamToModel(d *domain.Team) *model.Team {
	if d == nil {
		return nil
	}
	return &model.Team{
		ID:          d.ID,
		Slug:        d.Slug,
		Name:        d.Name,
		Description: d.Description,
		AvatarURL:   d.AvatarURL,
		OwnerID:     d.OwnerID,
		Status:      string(d.Status),
		CreatedAt:   d.CreatedAt,
		UpdatedAt:   d.UpdatedAt,
	}
}

func TeamMemberToDomain(m *model.TeamMember) *domain.TeamMember {
	if m == nil {
		return nil
	}
	return &domain.TeamMember{
		ID:        m.ID,
		TeamID:    m.TeamID,
		UserID:    m.UserID,
		Role:      domain.TeamRole(m.Role),
		JoinedAt:  m.JoinedAt,
		CreatedAt: m.CreatedAt,
	}
}

func TeamMemberToModel(d *domain.TeamMember) *model.TeamMember {
	if d == nil {
		return nil
	}
	return &model.TeamMember{
		ID:        d.ID,
		TeamID:    d.TeamID,
		UserID:    d.UserID,
		Role:      string(d.Role),
		JoinedAt:  d.JoinedAt,
		CreatedAt: d.CreatedAt,
	}
}

func InvitationToDomain(m *model.TeamInvitation) *domain.TeamInvitation {
	if m == nil {
		return nil
	}
	return &domain.TeamInvitation{
		ID:        m.ID,
		TeamID:    m.TeamID,
		Email:     m.Email,
		Role:      domain.TeamRole(m.Role),
		InvitedBy: m.InvitedBy,
		Status:    domain.InvitationStatus(m.Status),
		ExpiresAt: m.ExpiresAt,
		CreatedAt: m.CreatedAt,
	}
}

func InvitationToModel(d *domain.TeamInvitation) *model.TeamInvitation {
	if d == nil {
		return nil
	}
	return &model.TeamInvitation{
		ID:        d.ID,
		TeamID:    d.TeamID,
		Email:     d.Email,
		Role:      string(d.Role),
		InvitedBy: d.InvitedBy,
		Status:    string(d.Status),
		ExpiresAt: d.ExpiresAt,
		CreatedAt: d.CreatedAt,
	}
}

func JoinLinkToDomain(m *model.TeamJoinLink) *domain.TeamJoinLink {
	if m == nil {
		return nil
	}
	return &domain.TeamJoinLink{
		ID:         m.ID,
		TeamID:     m.TeamID,
		TokenHash:  m.TokenHash,
		Role:       domain.TeamRole(m.Role),
		CreatedBy:  m.CreatedBy,
		ExpiresAt:  m.ExpiresAt,
		RevokedAt:  m.RevokedAt,
		LastUsedAt: m.LastUsedAt,
		CreatedAt:  m.CreatedAt,
	}
}

func JoinLinkToModel(d *domain.TeamJoinLink) *model.TeamJoinLink {
	if d == nil {
		return nil
	}
	return &model.TeamJoinLink{
		ID:         d.ID,
		TeamID:     d.TeamID,
		TokenHash:  d.TokenHash,
		Role:       string(d.Role),
		CreatedBy:  d.CreatedBy,
		ExpiresAt:  d.ExpiresAt,
		RevokedAt:  d.RevokedAt,
		LastUsedAt: d.LastUsedAt,
		CreatedAt:  d.CreatedAt,
	}
}
