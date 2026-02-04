package mapper

import (
	"zeus/internal/domain"
	"zeus/internal/modules/user/repository/postgres/model"
)

func UserToDomain(m *model.User) *domain.User {
	if m == nil {
		return nil
	}
	return &domain.User{
		ID:              m.ID,
		Email:           m.Email,
		Username:        m.Username,
		PasswordHash:    m.PasswordHash,
		DisplayName:     m.DisplayName,
		AvatarURL:       m.AvatarURL,
		Status:          domain.UserStatus(m.Status),
		EmailVerifiedAt: m.EmailVerifiedAt,
		CreatedAt:       m.CreatedAt,
		UpdatedAt:       m.UpdatedAt,
	}
}

func UserToModel(d *domain.User) *model.User {
	if d == nil {
		return nil
	}
	return &model.User{
		ID:              d.ID,
		Email:           d.Email,
		Username:        d.Username,
		PasswordHash:    d.PasswordHash,
		DisplayName:     d.DisplayName,
		AvatarURL:       d.AvatarURL,
		Status:          string(d.Status),
		EmailVerifiedAt: d.EmailVerifiedAt,
		CreatedAt:       d.CreatedAt,
		UpdatedAt:       d.UpdatedAt,
	}
}

func SessionToDomain(m *model.Session) *domain.Session {
	if m == nil {
		return nil
	}
	var deviceInfo, ipAddress string
	if m.DeviceInfo != nil {
		deviceInfo = *m.DeviceInfo
	}
	if m.IPAddress != nil {
		ipAddress = *m.IPAddress
	}
	return &domain.Session{
		ID:         m.ID,
		UserID:     m.UserID,
		TokenHash:  m.TokenHash,
		DeviceInfo: deviceInfo,
		IPAddress:  ipAddress,
		ExpiresAt:  m.ExpiresAt,
		CreatedAt:  m.CreatedAt,
	}
}

func SessionToModel(d *domain.Session) *model.Session {
	if d == nil {
		return nil
	}
	var deviceInfo, ipAddress *string
	if d.DeviceInfo != "" {
		deviceInfo = &d.DeviceInfo
	}
	if d.IPAddress != "" {
		ipAddress = &d.IPAddress
	}
	return &model.Session{
		ID:         d.ID,
		UserID:     d.UserID,
		TokenHash:  d.TokenHash,
		DeviceInfo: deviceInfo,
		IPAddress:  ipAddress,
		ExpiresAt:  d.ExpiresAt,
		CreatedAt:  d.CreatedAt,
	}
}
