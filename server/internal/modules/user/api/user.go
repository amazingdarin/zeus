package api

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"zeus/internal/core/middleware"
	"zeus/internal/domain"
	usersvc "zeus/internal/modules/user/service"
)

// UserHandler handles user API endpoints
type UserHandler struct {
	userService *usersvc.UserService
}

// NewUserHandler creates a new user handler
func NewUserHandler(userService *usersvc.UserService) *UserHandler {
	return &UserHandler{
		userService: userService,
	}
}

// GetProfile returns the current user's profile
// GET /api/users/me
func (h *UserHandler) GetProfile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    "UNAUTHORIZED",
			"message": "not authenticated",
		})
		return
	}

	user, err := h.userService.GetByID(c.Request.Context(), userID)
	if err != nil {
		handleUserError(c, err)
		return
	}

	c.JSON(http.StatusOK, toUserProfileResponse(user))
}

// UpdateProfile updates the current user's profile
// PUT /api/users/me
func (h *UserHandler) UpdateProfile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    "UNAUTHORIZED",
			"message": "not authenticated",
		})
		return
	}

	var req UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_REQUEST",
			"message": err.Error(),
		})
		return
	}

	user, err := h.userService.UpdateProfile(c.Request.Context(), userID, usersvc.UpdateProfileInput{
		DisplayName: req.DisplayName,
		AvatarURL:   req.AvatarURL,
		Username:    req.Username,
	})
	if err != nil {
		handleUserError(c, err)
		return
	}

	c.JSON(http.StatusOK, toUserProfileResponse(user))
}

// ChangePassword changes the current user's password
// PUT /api/users/me/password
func (h *UserHandler) ChangePassword(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":    "UNAUTHORIZED",
			"message": "not authenticated",
		})
		return
	}

	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_REQUEST",
			"message": err.Error(),
		})
		return
	}

	err := h.userService.ChangePassword(c.Request.Context(), userID, usersvc.ChangePasswordInput{
		CurrentPassword: req.CurrentPassword,
		NewPassword:     req.NewPassword,
	})
	if err != nil {
		handleUserError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "password changed successfully",
	})
}

// GetPublicProfile returns a user's public profile
// GET /api/users/:username
func (h *UserHandler) GetPublicProfile(c *gin.Context) {
	username := c.Param("username")
	if username == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_REQUEST",
			"message": "username is required",
		})
		return
	}

	info, err := h.userService.GetPublicProfile(c.Request.Context(), username)
	if err != nil {
		handleUserError(c, err)
		return
	}

	c.JSON(http.StatusOK, PublicUserResponse{
		ID:          info.ID,
		Username:    info.Username,
		DisplayName: info.DisplayName,
		AvatarURL:   info.AvatarURL,
	})
}

func toUserProfileResponse(user *domain.User) UserProfileResponse {
	return UserProfileResponse{
		ID:          user.ID,
		Email:       user.Email,
		Username:    user.Username,
		DisplayName: user.DisplayName,
		AvatarURL:   user.AvatarURL,
		Status:      string(user.Status),
		CreatedAt:   user.CreatedAt,
	}
}

func handleUserError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, usersvc.ErrUserNotFound):
		c.JSON(http.StatusNotFound, gin.H{
			"code":    "USER_NOT_FOUND",
			"message": "user not found",
		})
	case errors.Is(err, usersvc.ErrInvalidPassword):
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_PASSWORD",
			"message": "current password is incorrect",
		})
	case errors.Is(err, usersvc.ErrUsernameExists):
		c.JSON(http.StatusConflict, gin.H{
			"code":    "USERNAME_EXISTS",
			"message": "username already taken",
		})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "INTERNAL_ERROR",
			"message": "an unexpected error occurred",
		})
	}
}
