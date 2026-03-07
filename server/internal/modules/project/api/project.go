package api

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"time"

	"zeus/internal/modules/project/service"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/core/middleware"
	"zeus/internal/domain"
)

type TeamAccessService interface {
	ListByUser(ctx context.Context, userID string) ([]*domain.Team, error)
	GetBySlug(ctx context.Context, slug string) (*domain.Team, error)
	GetUserRole(ctx context.Context, teamSlug, userID string) (domain.TeamRole, error)
}

type ProjectHandler struct {
	svc     service.ProjectService
	teamSvc TeamAccessService
}

func NewProjectHandler(svc service.ProjectService, teamSvc TeamAccessService) *ProjectHandler {
	return &ProjectHandler{svc: svc, teamSvc: teamSvc}
}

func toProjectDTO(project *domain.Project, ownerKey, ownerName string, canWrite bool) *types.ProjectDTO {
	if project == nil {
		return nil
	}
	return &types.ProjectDTO{
		ID:          project.ID,
		Key:         project.Key,
		Name:        project.Name,
		Description: project.Description,
		RepoURL:     project.RepoURL,
		RepoBaseURL: project.RepoBaseURL,
		RepoName:    project.RepoName,
		Status:      string(project.Status),
		CreatedAt:   project.CreatedAt.Format(time.RFC3339),
		OwnerType:   mapOwnerTypeToResponse(project.OwnerType),
		OwnerKey:    ownerKey,
		OwnerID:     project.OwnerID,
		OwnerName:   ownerName,
		CanWrite:    canWrite,
	}
}

func mapOwnerTypeToResponse(ownerType domain.OwnerType) string {
	if ownerType == domain.OwnerTypeTeam {
		return "team"
	}
	return "personal"
}

func mapOwnerTypeFromRequest(ownerType string) domain.OwnerType {
	normalized := strings.TrimSpace(strings.ToLower(ownerType))
	if normalized == "team" {
		return domain.OwnerTypeTeam
	}
	return domain.OwnerTypeUser
}

func (h *ProjectHandler) Create(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, types.CreateProjectResponse{Code: "UNAUTHORIZED", Message: "user not authenticated"})
		return
	}

	var req types.CreateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.CreateProjectResponse{Code: "INVALID_REQUEST", Message: err.Error()})
		return
	}

	normalizedOwnerType := strings.TrimSpace(strings.ToLower(req.OwnerType))
	if normalizedOwnerType != "" && normalizedOwnerType != "personal" && normalizedOwnerType != "team" {
		c.JSON(http.StatusBadRequest, types.CreateProjectResponse{Code: "INVALID_OWNER", Message: "owner_type must be personal or team"})
		return
	}

	ownerType := mapOwnerTypeFromRequest(req.OwnerType)
	ownerID := userID
	ownerKey := "me"
	ownerName := "个人"
	visibility := domain.ProjectVisibilityPrivate

	if ownerType == domain.OwnerTypeTeam {
		if h.teamSvc == nil {
			c.JSON(http.StatusInternalServerError, types.CreateProjectResponse{Code: "TEAM_SERVICE_UNAVAILABLE", Message: "team service unavailable"})
			return
		}
		teamSlug := strings.TrimSpace(req.OwnerKey)
		if teamSlug == "" {
			c.JSON(http.StatusBadRequest, types.CreateProjectResponse{Code: "INVALID_OWNER", Message: "owner_key is required for team project"})
			return
		}

		team, err := h.teamSvc.GetBySlug(c.Request.Context(), teamSlug)
		if err != nil || team == nil {
			c.JSON(http.StatusNotFound, types.CreateProjectResponse{Code: "TEAM_NOT_FOUND", Message: "team not found"})
			return
		}

		role, err := h.teamSvc.GetUserRole(c.Request.Context(), teamSlug, userID)
		if err != nil {
			c.JSON(http.StatusForbidden, types.CreateProjectResponse{Code: "NOT_TEAM_MEMBER", Message: "you are not a team member"})
			return
		}
		if !role.CanCreateProject() {
			c.JSON(http.StatusForbidden, types.CreateProjectResponse{Code: "FORBIDDEN", Message: "insufficient permission to create team project"})
			return
		}

		ownerID = team.ID
		ownerKey = team.Slug
		ownerName = team.Name
		visibility = domain.ProjectVisibilityTeam
	}

	project := &domain.Project{
		Key:         req.Key,
		Name:        req.Name,
		Description: req.Description,
		OwnerType:   ownerType,
		OwnerID:     ownerID,
		Visibility:  visibility,
		Status:      domain.ProjectStatusActive,
	}

	if err := h.svc.Create(c.Request.Context(), project); err != nil {
		c.JSON(http.StatusInternalServerError, types.CreateProjectResponse{Code: "CREATE_PROJECT_FAILED", Message: err.Error()})
		return
	}

	c.JSON(http.StatusCreated, types.CreateProjectResponse{
		Code:    "OK",
		Message: "success",
		Data:    toProjectDTO(project, ownerKey, ownerName, true),
	})
}

func (h *ProjectHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, types.ListProjectResponse{Code: "UNAUTHORIZED", Message: "user not authenticated"})
		return
	}

	teamByID := map[string]*domain.Team{}
	teamRoleByID := map[string]domain.TeamRole{}
	teamIDs := make([]string, 0)
	teamContexts := make([]*types.ProjectOwnerContextDTO, 0)

	if h.teamSvc != nil {
		teams, err := h.teamSvc.ListByUser(c.Request.Context(), userID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, types.ListProjectResponse{Code: "LIST_PROJECT_FAILED", Message: err.Error()})
			return
		}

		sort.SliceStable(teams, func(i, j int) bool {
			left := strings.ToLower(strings.TrimSpace(teams[i].Name))
			right := strings.ToLower(strings.TrimSpace(teams[j].Name))
			if left == right {
				return teams[i].Slug < teams[j].Slug
			}
			return left < right
		})

		for _, team := range teams {
			if team == nil {
				continue
			}
			teamByID[team.ID] = team
			teamIDs = append(teamIDs, team.ID)

			role, err := h.teamSvc.GetUserRole(c.Request.Context(), team.Slug, userID)
			if err != nil {
				role = domain.TeamRoleViewer
			}
			teamRoleByID[team.ID] = role
			teamContexts = append(teamContexts, &types.ProjectOwnerContextDTO{
				OwnerType: "team",
				OwnerKey:  team.Slug,
				OwnerID:   team.ID,
				OwnerName: team.Name,
				MyRole:    string(role),
				CanCreate: role.CanCreateProject(),
			})
		}
	}

	projects, err := h.svc.ListForUser(c.Request.Context(), userID, teamIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ListProjectResponse{Code: "LIST_PROJECT_FAILED", Message: err.Error()})
		return
	}

	items := make([]*types.ProjectDTO, 0, len(projects))
	for _, project := range projects {
		if project == nil {
			continue
		}

		ownerKey := "me"
		ownerName := "个人"
		canWrite := project.OwnerType == domain.OwnerTypeUser && project.OwnerID == userID

		if project.OwnerType == domain.OwnerTypeTeam {
			ownerKey = project.OwnerID
			ownerName = project.OwnerID
			if team, ok := teamByID[project.OwnerID]; ok && team != nil {
				ownerKey = team.Slug
				ownerName = team.Name
			}
			if role, ok := teamRoleByID[project.OwnerID]; ok {
				canWrite = role.CanCreateProject()
			}
		}

		items = append(items, toProjectDTO(project, ownerKey, ownerName, canWrite))
	}

	contexts := make([]*types.ProjectOwnerContextDTO, 0, len(teamContexts)+1)
	contexts = append(contexts, &types.ProjectOwnerContextDTO{
		OwnerType: "personal",
		OwnerKey:  "me",
		OwnerID:   userID,
		OwnerName: "个人",
		MyRole:    "owner",
		CanCreate: true,
	})
	contexts = append(contexts, teamContexts...)

	c.JSON(http.StatusOK, types.ListProjectResponse{
		Code:    "OK",
		Message: "success",
		Data: &types.ListProjectResponseData{
			Contexts: contexts,
			Projects: items,
		},
	})
}
