package handler

import (
	"context"
	"net/http"
	"path/filepath"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"zeus/internal/api/types"
	"zeus/internal/domain/docstore"
	"zeus/internal/service"
	svc "zeus/internal/service/docstore"
)

type DocumentHandler struct {
	projectSvc service.ProjectService
	repoRoot   string
	stores     sync.Map
}

func NewDocumentHandler(
	projectSvc service.ProjectService,
	repoRoot string,
) *DocumentHandler {
	return &DocumentHandler{
		projectSvc: projectSvc,
		repoRoot:   repoRoot,
	}
}

func (h *DocumentHandler) getStore(projectKey string) (svc.Service, string, error) {
	if val, ok := h.stores.Load(projectKey); ok {
		return val.(svc.Service), "", nil
	}

	project, err := h.projectSvc.GetByKey(context.Background(), projectKey)
	if err != nil {
		return nil, "", err
	}

	projectDir := filepath.Join(h.repoRoot, projectKey)

	newSvc := svc.NewService(projectDir)

	actual, _ := h.stores.LoadOrStore(projectKey, newSvc)
	return actual.(svc.Service), project.ID, nil
}

func (h *DocumentHandler) List(c *gin.Context) {
	projectKey := c.Param("project_key")
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "MISSING_PROJECT_KEY", Message: "project_key is required"})
		return
	}
	parentID := c.Query("parent_id")

	project, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey)
	if err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "PROJECT_NOT_FOUND", Message: err.Error()})
		return
	}

	docSvc := h.ensureStore(projectKey)

	items, err := docSvc.GetChildren(c.Request.Context(), project.ID, parentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "LIST_FAILED", Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, types.ListDocumentsResponse{
		Code:    "OK",
		Message: "success",
		Data:    items,
	})
}

func (h *DocumentHandler) Get(c *gin.Context) {
	projectKey := c.Param("project_key")
	docID := c.Param("doc_id")
	if projectKey == "" || docID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_PARAMS", Message: "project_key and doc_id are required"})
		return
	}

	project, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey)
	if err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "PROJECT_NOT_FOUND", Message: err.Error()})
		return
	}

	docSvc := h.ensureStore(projectKey)
	doc, err := docSvc.Get(c.Request.Context(), project.ID, docID)
	if err != nil {
		if err == svc.ErrNotFound {
			c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "NOT_FOUND", Message: "document not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "GET_FAILED", Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, types.GetDocumentResponse{
		Code:    "OK",
		Message: "success",
		Data: types.DocumentDTO{
			Meta: doc.Meta,
			Body: doc.Body,
		},
	})
}

func (h *DocumentHandler) Create(c *gin.Context) {
	projectKey := c.Param("project_key")
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "MISSING_PROJECT_KEY", Message: "project_key is required"})
		return
	}

	var req types.CreateDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_REQUEST", Message: err.Error()})
		return
	}

	project, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey)
	if err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "PROJECT_NOT_FOUND", Message: err.Error()})
		return
	}

	docSvc := h.ensureStore(projectKey)

	if req.Meta.ID == "" {
		req.Meta.ID = uuid.NewString()
	}
	if req.Meta.Title == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "MISSING_TITLE", Message: "title is required"})
		return
	}

	doc := &docstore.Document{
		Meta: req.Meta,
		Body: req.Body,
	}

	if err := docSvc.Save(c.Request.Context(), project.ID, doc); err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "SAVE_FAILED", Message: err.Error()})
		return
	}

	c.JSON(http.StatusCreated, types.CreateDocumentResponse{
		Code:    "OK",
		Message: "success",
		Data: types.DocumentDTO{
			Meta: doc.Meta,
			Body: doc.Body,
		},
	})
}

func (h *DocumentHandler) Delete(c *gin.Context) {
	projectKey := c.Param("project_key")
	docID := c.Param("doc_id")
	if projectKey == "" || docID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_PARAMS", Message: "project_key and doc_id are required"})
		return
	}

	project, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey)
	if err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "PROJECT_NOT_FOUND", Message: err.Error()})
		return
	}

	docSvc := h.ensureStore(projectKey)

	if err := docSvc.Delete(c.Request.Context(), project.ID, docID); err != nil {
		if err == svc.ErrNotFound {
			c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "NOT_FOUND", Message: "document not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "DELETE_FAILED", Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, types.ErrorResponse{Code: "OK", Message: "success"})
}

func (h *DocumentHandler) Move(c *gin.Context) {
	projectKey := c.Param("project_key")
	docID := c.Param("doc_id")
	if projectKey == "" || docID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_PARAMS", Message: "project_key and doc_id are required"})
		return
	}

	var req types.MoveDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_REQUEST", Message: err.Error()})
		return
	}

	project, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey)
	if err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "PROJECT_NOT_FOUND", Message: err.Error()})
		return
	}

	docSvc := h.ensureStore(projectKey)

	if err := docSvc.Move(c.Request.Context(), project.ID, docID, req.TargetParentID, req.Index); err != nil {
		if err == svc.ErrNotFound {
			c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "NOT_FOUND", Message: "document or target parent not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "MOVE_FAILED", Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, types.MoveDocumentResponse{Code: "OK", Message: "success"})
}

func (h *DocumentHandler) ensureStore(projectKey string) svc.Service {
	if val, ok := h.stores.Load(projectKey); ok {
		return val.(svc.Service)
	}
	projectDir := filepath.Join(h.repoRoot, projectKey)
	docSvc := svc.NewService(projectDir)
	actual, _ := h.stores.LoadOrStore(projectKey, docSvc)
	return actual.(svc.Service)
}
