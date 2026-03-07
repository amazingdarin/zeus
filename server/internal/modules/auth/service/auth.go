package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"zeus/internal/domain"
	"zeus/internal/infra/jwt"
	projectsvc "zeus/internal/modules/project/service"
	userrepo "zeus/internal/modules/user/repository"
	userpostgres "zeus/internal/modules/user/repository/postgres"
)

var (
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrEmailAlreadyExists = errors.New("email already exists")
	ErrUsernameExists     = errors.New("username already exists")
	ErrUserNotActive      = errors.New("user account is not active")
	ErrInvalidToken       = errors.New("invalid or expired token")
)

// AuthService handles authentication operations
type AuthService struct {
	userRepo       userrepo.UserRepository
	sessionRepo    userrepo.SessionRepository
	projectService projectsvc.ProjectService
	jwtManager     *jwt.JWTManager
	bcryptCost     int
}

// NewAuthService creates a new auth service
func NewAuthService(
	userRepo userrepo.UserRepository,
	sessionRepo userrepo.SessionRepository,
	projectService projectsvc.ProjectService,
	jwtManager *jwt.JWTManager,
	bcryptCost int,
) *AuthService {
	return &AuthService{
		userRepo:       userRepo,
		sessionRepo:    sessionRepo,
		projectService: projectService,
		jwtManager:     jwtManager,
		bcryptCost:     bcryptCost,
	}
}

// RegisterInput represents registration request data
type RegisterInput struct {
	Email       string
	Username    string
	Password    string
	DisplayName string
}

// RegisterResult represents registration result
type RegisterResult struct {
	User        *domain.User
	AccessToken string
	RefreshToken string
	ExpiresAt   time.Time
}

// Register creates a new user account
func (s *AuthService) Register(ctx context.Context, input RegisterInput) (*RegisterResult, error) {
	// Check if email already exists
	exists, err := s.userRepo.ExistsByEmail(ctx, input.Email)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, ErrEmailAlreadyExists
	}

	// Check if username already exists
	exists, err = s.userRepo.ExistsByUsername(ctx, input.Username)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, ErrUsernameExists
	}

	// Hash password
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.Password), s.bcryptCost)
	if err != nil {
		return nil, err
	}

	// Create user
	now := time.Now()
	user := &domain.User{
		ID:           uuid.New().String(),
		Email:        input.Email,
		Username:     input.Username,
		PasswordHash: string(passwordHash),
		DisplayName:  input.DisplayName,
		Language:     domain.DefaultUserLanguage,
		Status:       domain.UserStatusActive,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	if err := user.Validate(); err != nil {
		return nil, err
	}

	if err := s.userRepo.Create(ctx, user); err != nil {
		if errors.Is(err, userpostgres.ErrUserAlreadyExists) {
			return nil, ErrEmailAlreadyExists
		}
		return nil, err
	}

	// Generate tokens
	tokenPair, err := s.jwtManager.GenerateTokenPair(user.ID, user.Email, user.Username)
	if err != nil {
		return nil, err
	}

	// Store refresh token
	session := &domain.Session{
		ID:        uuid.New().String(),
		UserID:    user.ID,
		TokenHash: jwt.HashToken(tokenPair.RefreshToken),
		ExpiresAt: time.Now().Add(s.jwtManager.RefreshTokenTTL()),
		CreatedAt: now,
	}
	if err := s.sessionRepo.Create(ctx, session); err != nil {
		return nil, err
	}

	// Create default project for the new user
	if s.projectService != nil {
		defaultProjectName := "我的文档"
		if user.DisplayName != "" {
			defaultProjectName = fmt.Sprintf("%s 的文档", user.DisplayName)
		} else {
			defaultProjectName = fmt.Sprintf("%s 的文档", user.Username)
		}
		defaultProject := &domain.Project{
			ID:          uuid.New().String(),
			Key:         fmt.Sprintf("%s-docs", user.Username),
			Name:        defaultProjectName,
			Description: "默认文档项目",
			OwnerType:   domain.OwnerTypeUser,
			OwnerID:     user.ID,
			Visibility:  domain.ProjectVisibilityPrivate,
		}
		// Best effort: don't fail registration if project creation fails
		_ = s.projectService.Create(ctx, defaultProject)
	}

	return &RegisterResult{
		User:         user,
		AccessToken:  tokenPair.AccessToken,
		RefreshToken: tokenPair.RefreshToken,
		ExpiresAt:    tokenPair.ExpiresAt,
	}, nil
}

// LoginInput represents login request data
type LoginInput struct {
	Email      string
	Password   string
	DeviceInfo string
	IPAddress  string
	RememberMe bool
}

// Token TTL constants
const (
	DefaultRefreshTokenTTL  = 24 * time.Hour      // 1 day
	RememberMeRefreshTTL    = 7 * 24 * time.Hour  // 7 days
)

// LoginResult represents login result
type LoginResult struct {
	User         *domain.User
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
}

// Login authenticates a user
func (s *AuthService) Login(ctx context.Context, input LoginInput) (*LoginResult, error) {
	// Get user by email
	user, err := s.userRepo.GetByEmail(ctx, input.Email)
	if err != nil {
		if errors.Is(err, userpostgres.ErrUserNotFound) {
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}

	// Check user status
	if user.Status != domain.UserStatusActive {
		return nil, ErrUserNotActive
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	// Determine refresh token TTL based on "remember me" option
	refreshTTL := DefaultRefreshTokenTTL
	if input.RememberMe {
		refreshTTL = RememberMeRefreshTTL
	}

	// Generate tokens with custom refresh TTL
	tokenPair, err := s.jwtManager.GenerateTokenPairWithTTL(user.ID, user.Email, user.Username, refreshTTL)
	if err != nil {
		return nil, err
	}

	// Store refresh token
	session := &domain.Session{
		ID:         uuid.New().String(),
		UserID:     user.ID,
		TokenHash:  jwt.HashToken(tokenPair.RefreshToken),
		DeviceInfo: input.DeviceInfo,
		IPAddress:  input.IPAddress,
		ExpiresAt:  time.Now().Add(refreshTTL),
		CreatedAt:  time.Now(),
	}
	if err := s.sessionRepo.Create(ctx, session); err != nil {
		return nil, err
	}

	return &LoginResult{
		User:         user,
		AccessToken:  tokenPair.AccessToken,
		RefreshToken: tokenPair.RefreshToken,
		ExpiresAt:    tokenPair.ExpiresAt,
	}, nil
}

// Logout invalidates a refresh token
func (s *AuthService) Logout(ctx context.Context, refreshToken string) error {
	tokenHash := jwt.HashToken(refreshToken)
	return s.sessionRepo.DeleteByTokenHash(ctx, tokenHash)
}

// LogoutAll invalidates all sessions for a user
func (s *AuthService) LogoutAll(ctx context.Context, userID string) error {
	return s.sessionRepo.DeleteByUserID(ctx, userID)
}

// RefreshTokenResult represents refresh token result
type RefreshTokenResult struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
}

// RefreshToken generates new tokens from a valid refresh token
func (s *AuthService) RefreshToken(ctx context.Context, refreshToken string) (*RefreshTokenResult, error) {
	// Validate refresh token
	claims, err := s.jwtManager.ValidateRefreshToken(refreshToken)
	if err != nil {
		return nil, ErrInvalidToken
	}

	// Check if refresh token exists in database
	tokenHash := jwt.HashToken(refreshToken)
	session, err := s.sessionRepo.GetByTokenHash(ctx, tokenHash)
	if err != nil {
		return nil, ErrInvalidToken
	}

	// Check if session is expired
	if session.IsExpired() {
		_ = s.sessionRepo.Delete(ctx, session.ID)
		return nil, ErrInvalidToken
	}

	// Get user to ensure they're still active
	user, err := s.userRepo.GetByID(ctx, claims.UserID)
	if err != nil {
		return nil, ErrInvalidToken
	}
	if user.Status != domain.UserStatusActive {
		return nil, ErrUserNotActive
	}

	// Delete old session
	_ = s.sessionRepo.Delete(ctx, session.ID)

	// Generate new tokens
	tokenPair, err := s.jwtManager.GenerateTokenPair(user.ID, user.Email, user.Username)
	if err != nil {
		return nil, err
	}

	// Store new refresh token
	newSession := &domain.Session{
		ID:         uuid.New().String(),
		UserID:     user.ID,
		TokenHash:  jwt.HashToken(tokenPair.RefreshToken),
		DeviceInfo: session.DeviceInfo,
		IPAddress:  session.IPAddress,
		ExpiresAt:  time.Now().Add(s.jwtManager.RefreshTokenTTL()),
		CreatedAt:  time.Now(),
	}
	if err := s.sessionRepo.Create(ctx, newSession); err != nil {
		return nil, err
	}

	return &RefreshTokenResult{
		AccessToken:  tokenPair.AccessToken,
		RefreshToken: tokenPair.RefreshToken,
		ExpiresAt:    tokenPair.ExpiresAt,
	}, nil
}

// GetCurrentUser returns the current user by ID
func (s *AuthService) GetCurrentUser(ctx context.Context, userID string) (*domain.User, error) {
	return s.userRepo.GetByID(ctx, userID)
}

// CleanupExpiredSessions removes expired sessions
func (s *AuthService) CleanupExpiredSessions(ctx context.Context) (int64, error) {
	return s.sessionRepo.DeleteExpired(ctx)
}
