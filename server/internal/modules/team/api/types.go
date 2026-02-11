package api

import "time"

// CreateTeamRequest represents team creation request
type CreateTeamRequest struct {
	Name        string `json:"name" binding:"required,max=100"`
	Slug        string `json:"slug" binding:"required,min=3,max=40"`
	Description string `json:"description"`
}

// UpdateTeamRequest represents team update request
type UpdateTeamRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	AvatarURL   *string `json:"avatar_url"`
}

// TeamResponse represents team in response
type TeamResponse struct {
	ID          string    `json:"id"`
	Slug        string    `json:"slug"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	AvatarURL   string    `json:"avatar_url,omitempty"`
	OwnerID     string    `json:"owner_id"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

// AddMemberRequest represents add member request
type AddMemberRequest struct {
	UserID string `json:"user_id" binding:"required"`
	Role   string `json:"role" binding:"required,oneof=admin member viewer"`
}

// UpdateMemberRoleRequest represents role update request
type UpdateMemberRoleRequest struct {
	Role string `json:"role" binding:"required,oneof=admin member viewer"`
}

// TeamMemberResponse represents team member in response
type TeamMemberResponse struct {
	ID       string            `json:"id"`
	TeamID   string            `json:"team_id"`
	UserID   string            `json:"user_id"`
	Role     string            `json:"role"`
	JoinedAt time.Time         `json:"joined_at"`
	User     *UserInfoResponse `json:"user,omitempty"`
}

// UserInfoResponse represents user info in member response
type UserInfoResponse struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url,omitempty"`
}

// InviteMemberRequest represents invitation request
type InviteMemberRequest struct {
	Email string `json:"email" binding:"required,email"`
	Role  string `json:"role" binding:"required,oneof=admin member viewer"`
}

// InvitationResponse represents invitation in response
type InvitationResponse struct {
	ID        string    `json:"id"`
	TeamID    string    `json:"team_id"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	InvitedBy string    `json:"invited_by"`
	Status    string    `json:"status"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type CreateJoinLinkRequest struct {
	Role string `json:"role" binding:"omitempty,oneof=admin member viewer"`
}

type CreateJoinLinkResponse struct {
	ID        string    `json:"id"`
	Token     string    `json:"token"`
	TeamSlug  string    `json:"team_slug"`
	Role      string    `json:"role"`
	ExpiresAt time.Time `json:"expires_at"`
}

type JoinLinkPreviewResponse struct {
	TeamName  string    `json:"team_name"`
	TeamSlug  string    `json:"team_slug"`
	Role      string    `json:"role"`
	ExpiresAt time.Time `json:"expires_at"`
}

type JoinLinkJoinResponse struct {
	TeamSlug string `json:"team_slug"`
	TeamName string `json:"team_name"`
}
