package postgres

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"zeus/internal/domain"
	"zeus/internal/modules/user/repository/postgres/mapper"
	"zeus/internal/modules/user/repository/postgres/model"
)

var (
	ErrSessionNotFound = errors.New("session not found")
)

type SessionRepository struct {
	db *gorm.DB
}

func NewSessionRepository(db *gorm.DB) *SessionRepository {
	return &SessionRepository{db: db}
}

func (r *SessionRepository) Create(ctx context.Context, session *domain.Session) error {
	m := mapper.SessionToModel(session)
	result := r.db.WithContext(ctx).Create(m)
	return result.Error
}

func (r *SessionRepository) GetByTokenHash(ctx context.Context, tokenHash string) (*domain.Session, error) {
	var m model.Session
	result := r.db.WithContext(ctx).Where("token_hash = ?", tokenHash).First(&m)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, ErrSessionNotFound
		}
		return nil, result.Error
	}
	return mapper.SessionToDomain(&m), nil
}

func (r *SessionRepository) GetByUserID(ctx context.Context, userID string) ([]*domain.Session, error) {
	var models []model.Session
	result := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&models)
	if result.Error != nil {
		return nil, result.Error
	}
	sessions := make([]*domain.Session, len(models))
	for i, m := range models {
		sessions[i] = mapper.SessionToDomain(&m)
	}
	return sessions, nil
}

func (r *SessionRepository) Delete(ctx context.Context, id string) error {
	result := r.db.WithContext(ctx).Delete(&model.Session{}, "id = ?", id)
	return result.Error
}

func (r *SessionRepository) DeleteByTokenHash(ctx context.Context, tokenHash string) error {
	result := r.db.WithContext(ctx).Delete(&model.Session{}, "token_hash = ?", tokenHash)
	return result.Error
}

func (r *SessionRepository) DeleteByUserID(ctx context.Context, userID string) error {
	result := r.db.WithContext(ctx).Delete(&model.Session{}, "user_id = ?", userID)
	return result.Error
}

func (r *SessionRepository) DeleteExpired(ctx context.Context) (int64, error) {
	result := r.db.WithContext(ctx).Delete(&model.Session{}, "expires_at < ?", time.Now())
	return result.RowsAffected, result.Error
}
