package api

import (
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"zeus/internal/core/middleware"
	"zeus/internal/domain"
	teamsvc "zeus/internal/modules/team/service"
)

// TeamHandler handles team API endpoints
type TeamHandler struct {
	teamService *teamsvc.TeamService
}

// NewTeamHandler creates a new team handler
func NewTeamHandler(teamService *teamsvc.TeamService) *TeamHandler {
	return &TeamHandler{
		teamService: teamService,
	}
}

// Create creates a new team
// POST /api/teams
func (h *TeamHandler) Create(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "not authenticated"})
		return
	}

	var req CreateTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": err.Error()})
		return
	}

	team, err := h.teamService.Create(c.Request.Context(), userID, teamsvc.CreateInput{
		Name:        req.Name,
		Slug:        req.Slug,
		Description: req.Description,
	})
	if err != nil {
		handleTeamError(c, err)
		return
	}

	c.JSON(http.StatusCreated, toTeamResponse(team))
}

// List returns teams for the current user
// GET /api/teams
func (h *TeamHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "not authenticated"})
		return
	}

	teams, err := h.teamService.ListByUser(c.Request.Context(), userID)
	if err != nil {
		handleTeamError(c, err)
		return
	}

	response := make([]TeamResponse, len(teams))
	for i, t := range teams {
		response[i] = toTeamResponse(t)
	}

	c.JSON(http.StatusOK, response)
}

// Get returns a team by slug
// GET /api/teams/:slug
func (h *TeamHandler) Get(c *gin.Context) {
	slug := c.Param("slug")

	team, err := h.teamService.GetBySlug(c.Request.Context(), slug)
	if err != nil {
		handleTeamError(c, err)
		return
	}

	c.JSON(http.StatusOK, toTeamResponse(team))
}

// Update updates a team
// PUT /api/teams/:slug
func (h *TeamHandler) Update(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "not authenticated"})
		return
	}

	slug := c.Param("slug")

	var req UpdateTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": err.Error()})
		return
	}

	team, err := h.teamService.Update(c.Request.Context(), userID, slug, teamsvc.UpdateInput{
		Name:        req.Name,
		Description: req.Description,
		AvatarURL:   req.AvatarURL,
	})
	if err != nil {
		handleTeamError(c, err)
		return
	}

	c.JSON(http.StatusOK, toTeamResponse(team))
}

// Delete deletes a team
// DELETE /api/teams/:slug
func (h *TeamHandler) Delete(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "not authenticated"})
		return
	}

	slug := c.Param("slug")

	if err := h.teamService.Delete(c.Request.Context(), userID, slug); err != nil {
		handleTeamError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "team deleted"})
}

// ListMembers returns team members
// GET /api/teams/:slug/members
func (h *TeamHandler) ListMembers(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "not authenticated"})
		return
	}

	slug := c.Param("slug")

	members, err := h.teamService.ListMembers(c.Request.Context(), userID, slug)
	if err != nil {
		handleTeamError(c, err)
		return
	}

	response := make([]TeamMemberResponse, len(members))
	for i, m := range members {
		response[i] = toTeamMemberResponse(m)
	}

	c.JSON(http.StatusOK, response)
}

// AddMember adds a member to a team
// POST /api/teams/:slug/members
func (h *TeamHandler) AddMember(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "not authenticated"})
		return
	}

	slug := c.Param("slug")

	var req AddMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": err.Error()})
		return
	}

	err := h.teamService.AddMember(c.Request.Context(), userID, slug, teamsvc.AddMemberInput{
		UserID: req.UserID,
		Role:   domain.TeamRole(req.Role),
	})
	if err != nil {
		handleTeamError(c, err)
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "member added"})
}

// UpdateMemberRole updates a member's role
// PUT /api/teams/:slug/members/:userId
func (h *TeamHandler) UpdateMemberRole(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "not authenticated"})
		return
	}

	slug := c.Param("slug")
	targetUserID := c.Param("userId")

	var req UpdateMemberRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": err.Error()})
		return
	}

	err := h.teamService.UpdateMemberRole(c.Request.Context(), userID, slug, targetUserID, domain.TeamRole(req.Role))
	if err != nil {
		handleTeamError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "role updated"})
}

// RemoveMember removes a member from a team
// DELETE /api/teams/:slug/members/:userId
func (h *TeamHandler) RemoveMember(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "not authenticated"})
		return
	}

	slug := c.Param("slug")
	targetUserID := c.Param("userId")

	err := h.teamService.RemoveMember(c.Request.Context(), userID, slug, targetUserID)
	if err != nil {
		handleTeamError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "member removed"})
}

// InviteMember creates an invitation
// POST /api/teams/:slug/invitations
func (h *TeamHandler) InviteMember(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "not authenticated"})
		return
	}

	slug := c.Param("slug")

	var req InviteMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": err.Error()})
		return
	}

	invitation, err := h.teamService.InviteMember(c.Request.Context(), userID, slug, teamsvc.InviteInput{
		Email: req.Email,
		Role:  domain.TeamRole(req.Role),
	})
	if err != nil {
		handleTeamError(c, err)
		return
	}

	c.JSON(http.StatusCreated, toInvitationResponse(invitation))
}

// ListInvitations returns team invitations
// GET /api/teams/:slug/invitations
func (h *TeamHandler) ListInvitations(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "not authenticated"})
		return
	}

	slug := c.Param("slug")

	invitations, err := h.teamService.ListInvitations(c.Request.Context(), userID, slug)
	if err != nil {
		handleTeamError(c, err)
		return
	}

	response := make([]InvitationResponse, len(invitations))
	for i, inv := range invitations {
		response[i] = toInvitationResponse(inv)
	}

	c.JSON(http.StatusOK, response)
}

// AcceptInvitation accepts an invitation
// POST /api/invitations/:id/accept
func (h *TeamHandler) AcceptInvitation(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "not authenticated"})
		return
	}

	invitationID := c.Param("id")

	err := h.teamService.AcceptInvitation(c.Request.Context(), userID, invitationID)
	if err != nil {
		handleTeamError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "invitation accepted"})
}

// GetPendingInvitations returns pending invitations for current user
// GET /api/invitations/pending
func (h *TeamHandler) GetPendingInvitations(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "not authenticated"})
		return
	}

	invitations, err := h.teamService.GetPendingInvitations(c.Request.Context(), userID)
	if err != nil {
		handleTeamError(c, err)
		return
	}

	response := make([]InvitationResponse, len(invitations))
	for i, inv := range invitations {
		response[i] = toInvitationResponse(inv)
	}

	c.JSON(http.StatusOK, response)
}

// CreateJoinLink creates a reusable team join link
// POST /api/teams/:slug/join-links
func (h *TeamHandler) CreateJoinLink(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "not authenticated"})
		return
	}

	slug := c.Param("slug")

	var req CreateJoinLinkRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": err.Error()})
		return
	}

	result, err := h.teamService.CreateJoinLink(c.Request.Context(), userID, slug, teamsvc.CreateJoinLinkInput{
		Role: domain.TeamRole(req.Role),
	})
	if err != nil {
		handleTeamError(c, err)
		return
	}

	c.JSON(http.StatusCreated, CreateJoinLinkResponse{
		ID:        result.Link.ID,
		Token:     result.Token,
		TeamSlug:  result.TeamSlug,
		Role:      string(result.Link.Role),
		ExpiresAt: result.Link.ExpiresAt,
	})
}

// GetJoinLinkPreview returns public join link info
// GET /api/invite-links/:token
func (h *TeamHandler) GetJoinLinkPreview(c *gin.Context) {
	token := c.Param("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "missing token"})
		return
	}

	preview, err := h.teamService.GetJoinLinkPreview(c.Request.Context(), token)
	if err != nil {
		handleTeamError(c, err)
		return
	}

	c.JSON(http.StatusOK, JoinLinkPreviewResponse{
		TeamName:  preview.TeamName,
		TeamSlug:  preview.TeamSlug,
		Role:      string(preview.Role),
		ExpiresAt: preview.ExpiresAt,
	})
}

// JoinByLink joins current user to team by invite token
// POST /api/invite-links/:token/join
func (h *TeamHandler) JoinByLink(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "not authenticated"})
		return
	}

	token := c.Param("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "missing token"})
		return
	}

	team, err := h.teamService.JoinByLink(c.Request.Context(), userID, token)
	if err != nil {
		handleTeamError(c, err)
		return
	}

	c.JSON(http.StatusOK, JoinLinkJoinResponse{
		TeamSlug: team.Slug,
		TeamName: team.Name,
	})
}

func toTeamResponse(team *domain.Team) TeamResponse {
	return TeamResponse{
		ID:          team.ID,
		Slug:        team.Slug,
		Name:        team.Name,
		Description: team.Description,
		AvatarURL:   team.AvatarURL,
		OwnerID:     team.OwnerID,
		Status:      string(team.Status),
		CreatedAt:   team.CreatedAt,
	}
}

func toTeamMemberResponse(m *domain.TeamMemberWithUser) TeamMemberResponse {
	resp := TeamMemberResponse{
		ID:       m.ID,
		TeamID:   m.TeamID,
		UserID:   m.UserID,
		Role:     string(m.Role),
		JoinedAt: m.JoinedAt,
	}
	if m.User.ID != "" {
		resp.User = &UserInfoResponse{
			ID:          m.User.ID,
			Username:    m.User.Username,
			DisplayName: m.User.DisplayName,
			AvatarURL:   m.User.AvatarURL,
		}
	}
	return resp
}

func toInvitationResponse(inv *domain.TeamInvitation) InvitationResponse {
	return InvitationResponse{
		ID:        inv.ID,
		TeamID:    inv.TeamID,
		Email:     inv.Email,
		Role:      string(inv.Role),
		InvitedBy: inv.InvitedBy,
		Status:    string(inv.Status),
		ExpiresAt: inv.ExpiresAt,
		CreatedAt: inv.CreatedAt,
	}
}

func handleTeamError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, teamsvc.ErrTeamNotFound):
		c.JSON(http.StatusNotFound, gin.H{"code": "TEAM_NOT_FOUND", "message": "team not found"})
	case errors.Is(err, teamsvc.ErrTeamSlugExists):
		c.JSON(http.StatusConflict, gin.H{"code": "SLUG_EXISTS", "message": "team slug already exists"})
	case errors.Is(err, teamsvc.ErrNotTeamMember):
		c.JSON(http.StatusForbidden, gin.H{"code": "NOT_MEMBER", "message": "not a member of this team"})
	case errors.Is(err, teamsvc.ErrNotAuthorized):
		c.JSON(http.StatusForbidden, gin.H{"code": "NOT_AUTHORIZED", "message": "not authorized"})
	case errors.Is(err, teamsvc.ErrMemberExists):
		c.JSON(http.StatusConflict, gin.H{"code": "MEMBER_EXISTS", "message": "user is already a member"})
	case errors.Is(err, teamsvc.ErrCannotRemoveOwner):
		c.JSON(http.StatusForbidden, gin.H{"code": "CANNOT_REMOVE_OWNER", "message": "cannot remove team owner"})
	case errors.Is(err, teamsvc.ErrInvitationNotFound):
		c.JSON(http.StatusNotFound, gin.H{"code": "INVITATION_NOT_FOUND", "message": "invitation not found"})
	case errors.Is(err, teamsvc.ErrInvitationExpired):
		c.JSON(http.StatusGone, gin.H{"code": "INVITATION_EXPIRED", "message": "invitation has expired"})
	case errors.Is(err, teamsvc.ErrJoinLinkNotFound):
		c.JSON(http.StatusNotFound, gin.H{"code": "INVITE_LINK_NOT_FOUND", "message": "invite link not found"})
	case errors.Is(err, teamsvc.ErrJoinLinkExpired):
		c.JSON(http.StatusGone, gin.H{"code": "INVITE_LINK_EXPIRED", "message": "invite link has expired"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": "internal error"})
	}
}
