package handler

import (
	"net/http"
	"strings"
	"time"

	"zeus/internal/api/types"
	"zeus/internal/domain"
	"zeus/internal/service"

	"github.com/gin-gonic/gin"
)

type DocumentHandler struct {
	projectSvc  service.ProjectService
	documentSvc service.DocumentService
}

func NewDocumentHandler(
	projectSvc service.ProjectService,
	documentSvc service.DocumentService,
) *DocumentHandler {
	return &DocumentHandler{projectSvc: projectSvc, documentSvc: documentSvc}
}

// Create
// @route Post /api/projects/:project_key/documents
func (h *DocumentHandler) Create(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	if h.projectSvc == nil || h.documentSvc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "document service is required",
		})
		return
	}
	project, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "LOAD_PROJECT_FAILED",
			Message: err.Error(),
		})
		return
	}

	var req types.CreateDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "INVALID_REQUEST",
			Message: err.Error(),
		})
		return
	}
	if req.ProjectID != "" && req.ProjectID != project.ID {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "PROJECT_MISMATCH",
			Message: "project_id does not match project_key",
		})
		return
	}
	storageObjectID := strings.TrimSpace(req.StorageObjectID)
	if storageObjectID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_STORAGE_OBJECT",
			Message: "storage_object_id is required",
		})
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_TITLE",
			Message: "title is required",
		})
		return
	}

	doc := &domain.Document{
		ProjectID:   project.ID,
		Type:        domain.DocumentTypeOrigin,
		Title:       title,
		Description: strings.TrimSpace(req.Description),
		Status:      domain.DocumentStatusActive,
		StorageObject: &domain.StorageObject{
			ID: storageObjectID,
		},
	}
	parentID := strings.TrimSpace(req.ParentID)
	if parentID != "" {
		doc.Parent = &domain.Document{ID: parentID}
	}

	created, err := h.documentSvc.Create(c.Request.Context(), doc, "")
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "CREATE_DOCUMENT_FAILED",
			Message: err.Error(),
		})
		return
	}

	storageID := ""
	if created.StorageObject != nil {
		storageID = created.StorageObject.ID
	}
	resp := &types.ProjectDocumentDTO{
		ID:              created.ID,
		ProjectID:       created.ProjectID,
		Type:            string(created.Type),
		Title:           created.Title,
		Description:     created.Description,
		Status:          string(created.Status),
		Path:            created.Path,
		Order:           created.Order,
		ParentID:        parentID,
		HasChild:        created.HasChild,
		StorageObjectID: storageID,
		CreatedAt:       created.CreatedAt.Format(time.RFC3339),
		UpdatedAt:       created.UpdatedAt.Format(time.RFC3339),
	}

	c.JSON(http.StatusCreated, types.CreateDocumentResponse{
		Code:    "OK",
		Message: "success",
		Data:    resp,
	})

}

// List
// @route GET /api/projects/:project_key/documents
func (h *DocumentHandler) List(c *gin.Context) {
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

	documents, err := h.projectSvc.ListDocuments(c.Request.Context(), projectKey, req.ParentID)
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
