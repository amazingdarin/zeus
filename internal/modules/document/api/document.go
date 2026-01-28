package api

import (
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"zeus/internal/domain"
	service2 "zeus/internal/modules/document/service"
	svc "zeus/internal/modules/document/service/document"
	"zeus/internal/modules/project/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"zeus/internal/api/types"
)

type DocumentHandler struct {
	projectSvc  service.ProjectService
	documentSvc service2.DocumentService
}

func NewDocumentHandler(
	projectSvc service.ProjectService,
	documentSvc service2.DocumentService,
) *DocumentHandler {
	return &DocumentHandler{
		projectSvc:  projectSvc,
		documentSvc: documentSvc,
	}
}

func (h *DocumentHandler) List(c *gin.Context) {
	projectKey := c.Param("project_key")
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "MISSING_PROJECT_KEY", Message: "project_key is required"})
		return
	}
	parentID := c.Query("parent_id")

	if _, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey); err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "PROJECT_NOT_FOUND", Message: err.Error()})
		return
	}

	items, err := h.documentSvc.GetChildren(c.Request.Context(), projectKey, parentID)
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

	if _, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey); err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "PROJECT_NOT_FOUND", Message: err.Error()})
		return
	}

	doc, err := h.documentSvc.Get(c.Request.Context(), projectKey, docID)
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

func (h *DocumentHandler) GetHierarchy(c *gin.Context) {
	projectKey := c.Param("project_key")
	docID := c.Param("doc_id")
	if projectKey == "" || docID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_PARAMS", Message: "project_key and doc_id are required"})
		return
	}

	if _, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey); err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "PROJECT_NOT_FOUND", Message: err.Error()})
		return
	}

	chain, err := h.documentSvc.GetHierarchy(c.Request.Context(), projectKey, docID)
	if err != nil {
		if err == svc.ErrNotFound {
			c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "NOT_FOUND", Message: "document not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "GET_HIERARCHY_FAILED", Message: err.Error()})
		return
	}

	items := make([]types.DocumentHierarchyItem, 0, len(chain))
	for _, item := range chain {
		items = append(items, types.DocumentHierarchyItem{
			ID:       item.ID,
			Title:    item.Title,
			ParentID: item.ParentID,
		})
	}

	c.JSON(http.StatusOK, types.DocumentHierarchyResponse{
		Code:    "OK",
		Message: "success",
		Data:    items,
	})
}

func (h *DocumentHandler) GetBlock(c *gin.Context) {
	projectKey := c.Param("project_key")
	docID := c.Param("doc_id")
	blockID := c.Param("block_id")
	if projectKey == "" || docID == "" || blockID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_PARAMS", Message: "project_key, doc_id, and block_id are required"})
		return
	}

	if _, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey); err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "PROJECT_NOT_FOUND", Message: err.Error()})
		return
	}

	doc, err := h.documentSvc.GetBlockByID(c.Request.Context(), projectKey, docID, blockID)
	if err != nil {
		if err == svc.ErrNotFound {
			c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "NOT_FOUND", Message: "document not found"})
			return
		}
		if err == svc.ErrBlockNotFound {
			c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "BLOCK_NOT_FOUND", Message: "block not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "GET_BLOCK_FAILED", Message: err.Error()})
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

	if _, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey); err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "PROJECT_NOT_FOUND", Message: err.Error()})
		return
	}

	if req.Meta.ID == "" {
		req.Meta.ID = uuid.NewString()
	}
	if req.Meta.Title == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "MISSING_TITLE", Message: "title is required"})
		return
	}

	doc := &domain.Document{
		Meta: req.Meta,
		Body: req.Body,
	}

	if err := h.documentSvc.Save(c.Request.Context(), projectKey, doc); err != nil {
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

func (h *DocumentHandler) Import(c *gin.Context) {
	projectKey := c.Param("project_key")
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "MISSING_PROJECT_KEY", Message: "project_key is required"})
		return
	}

	if _, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey); err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "PROJECT_NOT_FOUND", Message: err.Error()})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_REQUEST", Message: "file is required"})
		return
	}

	parentID := strings.TrimSpace(c.PostForm("parent_id"))
	if parentID == "" {
		parentID = "root"
	}
	requestedType := strings.TrimSpace(c.PostForm("source_type"))
	resolvedType, err := resolveSourceType(fileHeader.Filename, requestedType)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, types.ErrorResponse{Code: "UNSUPPORTED_SOURCE_TYPE", Message: "unsupported source_type"})
		return
	}
	if resolvedType != "markdown" {
		c.JSON(http.StatusUnprocessableEntity, types.ErrorResponse{Code: "UNSUPPORTED_SOURCE_TYPE", Message: "unsupported source_type"})
		return
	}

	title := strings.TrimSpace(c.PostForm("title"))
	if title == "" {
		title = normalizeImportTitle(fileHeader.Filename)
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "READ_FAILED", Message: "failed to read file"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "READ_FAILED", Message: "failed to read file"})
		return
	}

	meta := domain.DocumentMeta{
		ID:            uuid.NewString(),
		SchemaVersion: "v1",
		Title:         title,
		ParentID:      parentID,
		Extra: map[string]interface{}{
			"status": "draft",
			"tags":   []string{},
		},
	}
	body := domain.DocumentBody{
		Type:    "tiptap",
		Content: data,
	}

	doc := &domain.Document{Meta: meta, Body: body}
	if err := h.documentSvc.Save(c.Request.Context(), projectKey, doc); err != nil {
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

	if _, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey); err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "PROJECT_NOT_FOUND", Message: err.Error()})
		return
	}

	if err := h.documentSvc.Delete(c.Request.Context(), projectKey, docID); err != nil {
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

	if _, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey); err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "PROJECT_NOT_FOUND", Message: err.Error()})
		return
	}

	if err := h.documentSvc.Move(
		c.Request.Context(),
		projectKey,
		docID,
		req.TargetParentID,
		req.BeforeDocID,
		req.AfterDocID,
	); err != nil {
		if err == svc.ErrNotFound {
			c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "NOT_FOUND", Message: "document or target parent not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "MOVE_FAILED", Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, types.MoveDocumentResponse{Code: "OK", Message: "success"})
}

func resolveSourceType(filename string, requested string) (string, error) {
	requested = strings.TrimSpace(strings.ToLower(requested))
	if requested != "" {
		return requested, nil
	}

	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(filename)))
	switch ext {
	case ".md", ".markdown":
		return "markdown", nil
	default:
		return "", errUnsupportedSourceType
	}
}

func normalizeImportTitle(filename string) string {
	trimmed := strings.TrimSpace(filename)
	if trimmed == "" {
		return "Untitled"
	}
	base := strings.TrimSuffix(trimmed, filepath.Ext(trimmed))
	base = strings.TrimSpace(base)
	if base == "" {
		return "Untitled"
	}
	return base
}

var errUnsupportedSourceType = errors.New("unsupported source_type")
