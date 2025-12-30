package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/domain"
	"zeus/internal/service"
)

type ProjectHandler struct {
	svc service.ProjectService
}

func NewProjectHandler(svc service.ProjectService) *ProjectHandler {
	return &ProjectHandler{svc: svc}
}

// CreateProject
// @route POST /api/projects
func (h *ProjectHandler) CreateProject(c *gin.Context) {
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
			ID        string `json:"id"`
			CreatedAt string `json:"created_at"`
		}{
			ID:        project.ID,
			CreatedAt: project.CreatedAt.Format(time.RFC3339),
		},
	})
}

// ListProjects
// @route GET /api/projects
func (h *ProjectHandler) ListProjects(c *gin.Context) {
	projects, err := h.svc.List(c.Request.Context())
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

// ListProjectDocuments
// @route GET /api/projects/:project_key/documents
func (h *ProjectHandler) ListProjectDocuments(c *gin.Context) {
	projectKey := c.Param("project_key")
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ListProjectDocumentsResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}

	var req types.ListProjectDocumentsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ListProjectDocumentsResponse{
			Code:    "INVALID_QUERY",
			Message: err.Error(),
		})
		return
	}

	documents, err := h.svc.ListDocuments(c.Request.Context(), projectKey, req.ParentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ListProjectDocumentsResponse{
			Code:    "LIST_DOCUMENT_FAILED",
			Message: err.Error(),
		})
		return
	}

	items := make([]*types.ProjectDocumentDTO, 0, len(documents))
	for _, doc := range documents {
		if doc == nil {
			continue
		}
		parentID := ""
		if doc.Parent != nil {
			parentID = doc.Parent.ID
		}
		storageObjectID := ""
		if doc.StorageObject != nil {
			storageObjectID = doc.StorageObject.ID
		}
		items = append(items, &types.ProjectDocumentDTO{
			ID:              doc.ID,
			ProjectID:       doc.ProjectID,
			Type:            string(doc.Type),
			Title:           doc.Title,
			Description:     doc.Description,
			Status:          string(doc.Status),
			Path:            doc.Path,
			Order:           doc.Order,
			ParentID:        parentID,
			HasChild:        doc.HasChild,
			StorageObjectID: storageObjectID,
			CreatedAt:       doc.CreatedAt.Format(time.RFC3339),
			UpdatedAt:       doc.UpdatedAt.Format(time.RFC3339),
		})
	}

	c.JSON(http.StatusOK, types.ListProjectDocumentsResponse{
		Code:    "OK",
		Message: "success",
		Data:    items,
	})
}
