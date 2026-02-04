package service

import (
	"context"
	"errors"

	"golang.org/x/crypto/bcrypt"

	"zeus/internal/domain"
	userrepo "zeus/internal/modules/user/repository"
	userpostgres "zeus/internal/modules/user/repository/postgres"
)

var (
	ErrUserNotFound      = errors.New("user not found")
	ErrInvalidPassword   = errors.New("invalid current password")
	ErrUsernameExists    = errors.New("username already exists")
)

// UserService handles user profile operations
type UserService struct {
	userRepo   userrepo.UserRepository
	bcryptCost int
}

// NewUserService creates a new user service
func NewUserService(userRepo userrepo.UserRepository, bcryptCost int) *UserService {
	return &UserService{
		userRepo:   userRepo,
		bcryptCost: bcryptCost,
	}
}

// GetByID returns a user by ID
func (s *UserService) GetByID(ctx context.Context, id string) (*domain.User, error) {
	user, err := s.userRepo.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, userpostgres.ErrUserNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return user, nil
}

// GetByUsername returns a user by username
func (s *UserService) GetByUsername(ctx context.Context, username string) (*domain.User, error) {
	user, err := s.userRepo.GetByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, userpostgres.ErrUserNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return user, nil
}

// UpdateProfileInput represents profile update data
type UpdateProfileInput struct {
	DisplayName *string
	AvatarURL   *string
	Username    *string
}

// UpdateProfile updates user profile
func (s *UserService) UpdateProfile(ctx context.Context, userID string, input UpdateProfileInput) (*domain.User, error) {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		if errors.Is(err, userpostgres.ErrUserNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}

	// Check if username is being changed
	if input.Username != nil && *input.Username != user.Username {
		exists, err := s.userRepo.ExistsByUsername(ctx, *input.Username)
		if err != nil {
			return nil, err
		}
		if exists {
			return nil, ErrUsernameExists
		}
		user.Username = *input.Username
	}

	if input.DisplayName != nil {
		user.DisplayName = *input.DisplayName
	}
	if input.AvatarURL != nil {
		user.AvatarURL = *input.AvatarURL
	}

	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, err
	}

	return user, nil
}

// ChangePasswordInput represents password change data
type ChangePasswordInput struct {
	CurrentPassword string
	NewPassword     string
}

// ChangePassword changes user password
func (s *UserService) ChangePassword(ctx context.Context, userID string, input ChangePasswordInput) error {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		if errors.Is(err, userpostgres.ErrUserNotFound) {
			return ErrUserNotFound
		}
		return err
	}

	// Verify current password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.CurrentPassword)); err != nil {
		return ErrInvalidPassword
	}

	// Hash new password
	newHash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), s.bcryptCost)
	if err != nil {
		return err
	}

	return s.userRepo.UpdatePassword(ctx, userID, string(newHash))
}

// GetPublicProfile returns public user info
func (s *UserService) GetPublicProfile(ctx context.Context, username string) (*domain.UserPublicInfo, error) {
	user, err := s.userRepo.GetByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, userpostgres.ErrUserNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}

	info := user.ToPublicInfo()
	return &info, nil
}
