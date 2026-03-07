package service

import (
	"context"
	"testing"
	"time"

	"zeus/internal/domain"
)

type stubUserRepo struct {
	user *domain.User
	updated *domain.User
}

func (s *stubUserRepo) Create(ctx context.Context, user *domain.User) error { return nil }
func (s *stubUserRepo) GetByID(ctx context.Context, id string) (*domain.User, error) { return s.user, nil }
func (s *stubUserRepo) GetByEmail(ctx context.Context, email string) (*domain.User, error) { return s.user, nil }
func (s *stubUserRepo) GetByUsername(ctx context.Context, username string) (*domain.User, error) { return s.user, nil }
func (s *stubUserRepo) Update(ctx context.Context, user *domain.User) error {
	s.updated = user
	return nil
}
func (s *stubUserRepo) UpdatePassword(ctx context.Context, id string, passwordHash string) error { return nil }
func (s *stubUserRepo) ExistsByEmail(ctx context.Context, email string) (bool, error) { return false, nil }
func (s *stubUserRepo) ExistsByUsername(ctx context.Context, username string) (bool, error) { return false, nil }

func TestUpdateProfileUpdatesLanguage(t *testing.T) {
	now := time.Now()
	repo := &stubUserRepo{
		user: &domain.User{
			ID: "user-1",
			Email: "test@example.com",
			Username: "tester",
			PasswordHash: "hash",
			DisplayName: "Tester",
			Status: domain.UserStatusActive,
			Language: "zh-CN",
			CreatedAt: now,
			UpdatedAt: now,
		},
	}
	service := NewUserService(repo, 4)
	language := "en"

	updated, err := service.UpdateProfile(context.Background(), "user-1", UpdateProfileInput{Language: &language})
	if err != nil {
		t.Fatalf("UpdateProfile returned error: %v", err)
	}
	if updated.Language != "en" {
		t.Fatalf("expected updated language en, got %q", updated.Language)
	}
	if repo.updated == nil || repo.updated.Language != "en" {
		t.Fatalf("expected repo update with language en, got %#v", repo.updated)
	}
}
