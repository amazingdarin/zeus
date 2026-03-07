package api

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"zeus/internal/core/middleware"
	"zeus/internal/domain"
	"zeus/internal/i18n"
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
		i18n.JSONError(c, http.StatusUnauthorized, "UNAUTHORIZED", "error.unauthorized")
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
		i18n.JSONError(c, http.StatusUnauthorized, "UNAUTHORIZED", "error.unauthorized")
		return
	}

	var req UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_REQUEST",
			"message": err.Error(),
			"locale":  i18n.ResolveLocale(c.Request),
		})
		return
	}

	user, err := h.userService.UpdateProfile(c.Request.Context(), userID, usersvc.UpdateProfileInput{
		DisplayName: req.DisplayName,
		AvatarURL:   req.AvatarURL,
		Username:    req.Username,
		Language:    req.Language,
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
		i18n.JSONError(c, http.StatusUnauthorized, "UNAUTHORIZED", "error.unauthorized")
		return
	}

	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_REQUEST",
			"message": err.Error(),
			"locale":  i18n.ResolveLocale(c.Request),
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

	i18n.JSONMessage(c, http.StatusOK, "success.password_changed")
}

// GetPublicProfile returns a user's public profile
// GET /api/users/:username
func (h *UserHandler) GetPublicProfile(c *gin.Context) {
	username := c.Param("username")
	if username == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_REQUEST",
			"message": i18n.Message(i18n.ResolveLocale(c.Request), "error.missing_username"),
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
		Language:    user.Language,
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
			"message": i18n.Message(i18n.ResolveLocale(c.Request), "error.user_not_found"),
		})
	case errors.Is(err, usersvc.ErrInvalidPassword):
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_PASSWORD",
			"message": i18n.Message(i18n.ResolveLocale(c.Request), "error.invalid_password"),
		})
	case errors.Is(err, usersvc.ErrUsernameExists):
		c.JSON(http.StatusConflict, gin.H{
			"code":    "USERNAME_EXISTS",
			"message": i18n.Message(i18n.ResolveLocale(c.Request), "error.username_exists"),
		})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "INTERNAL_ERROR",
			"message": i18n.Message(i18n.ResolveLocale(c.Request), "error.internal_error"),
		})
	}
}
