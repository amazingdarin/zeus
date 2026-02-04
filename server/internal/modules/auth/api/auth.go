package api

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"zeus/internal/core/middleware"
	"zeus/internal/domain"
	authsvc "zeus/internal/modules/auth/service"
)

// AuthHandler handles authentication API endpoints
type AuthHandler struct {
	authService *authsvc.AuthService
}

// NewAuthHandler creates a new auth handler
func NewAuthHandler(authService *authsvc.AuthService) *AuthHandler {
	return &AuthHandler{
		authService: authService,
	}
}

// Register handles user registration
// POST /api/auth/register
func (h *AuthHandler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_REQUEST",
			"message": err.Error(),
		})
		return
	}

	result, err := h.authService.Register(c.Request.Context(), authsvc.RegisterInput{
		Email:       req.Email,
		Username:    req.Username,
		Password:    req.Password,
		DisplayName: req.DisplayName,
	})
	if err != nil {
		handleAuthError(c, err)
		return
	}

	c.JSON(http.StatusCreated, AuthResponse{
		User:         toUserResponse(result.User),
		AccessToken:  result.AccessToken,
		RefreshToken: result.RefreshToken,
		ExpiresAt:    result.ExpiresAt,
	})
}

// Login handles user login
// POST /api/auth/login
func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_REQUEST",
			"message": err.Error(),
		})
		return
	}

	result, err := h.authService.Login(c.Request.Context(), authsvc.LoginInput{
		Email:      req.Email,
		Password:   req.Password,
		DeviceInfo: c.GetHeader("User-Agent"),
		IPAddress:  c.ClientIP(),
		RememberMe: req.RememberMe,
	})
	if err != nil {
		handleAuthError(c, err)
		return
	}

	c.JSON(http.StatusOK, AuthResponse{
		User:         toUserResponse(result.User),
		AccessToken:  result.AccessToken,
		RefreshToken: result.RefreshToken,
		ExpiresAt:    result.ExpiresAt,
	})
}

// Logout handles user logout
// POST /api/auth/logout
func (h *AuthHandler) Logout(c *gin.Context) {
	var req RefreshTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_REQUEST",
			"message": err.Error(),
		})
		return
	}

	if err := h.authService.Logout(c.Request.Context(), req.RefreshToken); err != nil {
		// Don't expose internal errors, just return success
		// The token might already be invalid
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "logged out successfully",
	})
}

// Refresh handles token refresh
// POST /api/auth/refresh
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req RefreshTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_REQUEST",
			"message": err.Error(),
		})
		return
	}

	result, err := h.authService.RefreshToken(c.Request.Context(), req.RefreshToken)
	if err != nil {
		handleAuthError(c, err)
		return
	}

	c.JSON(http.StatusOK, RefreshResponse{
		AccessToken:  result.AccessToken,
		RefreshToken: result.RefreshToken,
		ExpiresAt:    result.ExpiresAt,
	})
}

// Me returns the current authenticated user
// GET /api/auth/me
func (h *AuthHandler) Me(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    "UNAUTHORIZED",
			"message": "not authenticated",
		})
		return
	}

	user, err := h.authService.GetCurrentUser(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "INTERNAL_ERROR",
			"message": "failed to get user",
		})
		return
	}

	c.JSON(http.StatusOK, MeResponse{
		ID:          user.ID,
		Email:       user.Email,
		Username:    user.Username,
		DisplayName: user.DisplayName,
		AvatarURL:   user.AvatarURL,
		Status:      string(user.Status),
		CreatedAt:   user.CreatedAt,
	})
}

func toUserResponse(user *domain.User) UserResponse {
	return UserResponse{
		ID:          user.ID,
		Email:       user.Email,
		Username:    user.Username,
		DisplayName: user.DisplayName,
		AvatarURL:   user.AvatarURL,
		Status:      string(user.Status),
		CreatedAt:   user.CreatedAt,
	}
}

func handleAuthError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, authsvc.ErrInvalidCredentials):
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    "INVALID_CREDENTIALS",
			"message": "invalid email or password",
		})
	case errors.Is(err, authsvc.ErrEmailAlreadyExists):
		c.JSON(http.StatusConflict, gin.H{
			"code":    "EMAIL_EXISTS",
			"message": "email already registered",
		})
	case errors.Is(err, authsvc.ErrUsernameExists):
		c.JSON(http.StatusConflict, gin.H{
			"code":    "USERNAME_EXISTS",
			"message": "username already taken",
		})
	case errors.Is(err, authsvc.ErrUserNotActive):
		c.JSON(http.StatusForbidden, gin.H{
			"code":    "USER_NOT_ACTIVE",
			"message": "user account is not active",
		})
	case errors.Is(err, authsvc.ErrInvalidToken):
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    "INVALID_TOKEN",
			"message": "invalid or expired token",
		})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "INTERNAL_ERROR",
			"message": "an unexpected error occurred",
		})
	}
}
