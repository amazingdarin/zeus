package api

import (
	"net/http"
	"time"

	"zeus/internal/modules/project/service"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/core/middleware"
	"zeus/internal/domain"
)

// TeamIDsGetter is an interface to get team IDs for a user
type TeamIDsGetter interface {
	GetTeamIDsForUser(userID string) []string
}

type ProjectHandler struct {
	svc           service.ProjectService
	teamIDsGetter TeamIDsGetter
}

func NewProjectHandler(svc service.ProjectService, teamIDsGetter TeamIDsGetter) *ProjectHandler {
	return &ProjectHandler{
		svc:           svc,
		teamIDsGetter: teamIDsGetter,
	}
}

// Create
// @route POST /api/projects
func (h *ProjectHandler) Create(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, types.CreateProjectResponse{
			Code:    "UNAUTHORIZED",
			Message: "user not authenticated",
		})
		return
	}

	var req types.CreateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.CreateProjectResponse{
			Code:    "INVALID_REQUEST",
			Message: err.Error(),
		})
		return
	}

	project := &domain.Project{
		Key:         req.Key,
		Name:        req.Name,
		Description: req.Description,
		OwnerType:   domain.OwnerTypeUser,
		OwnerID:     userID,
		Visibility:  domain.ProjectVisibilityPrivate,
		Status:      domain.ProjectStatusActive,
	}

	if err := h.svc.Create(c.Request.Context(), project); err != nil {
		c.JSON(http.StatusInternalServerError, types.CreateProjectResponse{
			Code:    "CREATE_PROJECT_FAILED",
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, types.CreateProjectResponse{
		Code:    "OK",
		Message: "success",
		Data: struct {
			ID          string `json:"id"`
			RepoURL     string `json:"repo_url"`
			RepoBaseURL string `json:"repo_base_url"`
			RepoName    string `json:"repo_name"`
			CreatedAt   string `json:"created_at"`
		}{
			ID:          project.ID,
			RepoURL:     project.RepoURL,
			RepoBaseURL: project.RepoBaseURL,
			RepoName:    project.RepoName,
			CreatedAt:   project.CreatedAt.Format(time.RFC3339),
		},
	})
}

// List
// @route GET /api/projects
func (h *ProjectHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, types.ListProjectResponse{
			Code:    "UNAUTHORIZED",
			Message: "user not authenticated",
		})
		return
	}

	// Get user's team IDs
	var teamIDs []string
	if h.teamIDsGetter != nil {
		teamIDs = h.teamIDsGetter.GetTeamIDsForUser(userID)
	}

	projects, err := h.svc.ListForUser(c.Request.Context(), userID, teamIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ListProjectResponse{
			Code:    "LIST_PROJECT_FAILED",
			Message: err.Error(),
		})
		return
	}

	items := make([]*types.ProjectDTO, 0, len(projects))
	for _, project := range projects {
		if project == nil {
			continue
		}
		items = append(items, &types.ProjectDTO{
			ID:          project.ID,
			Key:         project.Key,
			Name:        project.Name,
			Description: project.Description,
			RepoURL:     project.RepoURL,
			RepoBaseURL: project.RepoBaseURL,
			RepoName:    project.RepoName,
			Status:      string(project.Status),
			CreatedAt:   project.CreatedAt.Format(time.RFC3339),
		})
	}

	c.JSON(http.StatusOK, types.ListProjectResponse{
		Code:    "OK",
		Message: "success",
		Data:    items,
	})
}
