package handler

import (
	"context"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"zeus/internal/api/types"
	"zeus/internal/domain/docstore"
	"zeus/internal/service"
	svc "zeus/internal/service/docstore"
	svcdocument "zeus/internal/service/document"
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

func (h *DocumentHandler) GetHierarchy(c *gin.Context) {
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
	chain, err := docSvc.GetHierarchy(c.Request.Context(), project.ID, docID)
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

	project, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey)
	if err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "PROJECT_NOT_FOUND", Message: err.Error()})
		return
	}

	docSvc := h.ensureStore(projectKey)
	doc, err := docSvc.GetBlockByID(c.Request.Context(), project.ID, docID, blockID)
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

func (h *DocumentHandler) Import(c *gin.Context) {
	projectKey := c.Param("project_key")
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "MISSING_PROJECT_KEY", Message: "project_key is required"})
		return
	}

	project, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey)
	if err != nil {
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
	resolvedType, err := svcdocument.ResolveSourceType(fileHeader.Filename, requestedType)
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
		title = svcdocument.NormalizeImportTitle(fileHeader.Filename)
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

	content, err := svcdocument.ConvertMarkdownToTiptapJSON(string(data))
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, types.ErrorResponse{Code: "CONVERT_FAILED", Message: err.Error()})
		return
	}

	meta := docstore.DocumentMeta{
		ID:            uuid.NewString(),
		SchemaVersion: "v1",
		Title:         title,
		ParentID:      parentID,
		Extra: map[string]interface{}{
			"status": "draft",
			"tags":   []string{},
		},
	}
	body := docstore.DocumentBody{
		Type:    "tiptap",
		Content: content,
	}

	doc := &docstore.Document{Meta: meta, Body: body}
	if err := h.ensureStore(projectKey).Save(c.Request.Context(), project.ID, doc); err != nil {
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

	if err := docSvc.Move(
		c.Request.Context(),
		project.ID,
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

func (h *DocumentHandler) ensureStore(projectKey string) svc.Service {
	if val, ok := h.stores.Load(projectKey); ok {
		return val.(svc.Service)
	}
	projectDir := filepath.Join(h.repoRoot, projectKey)
	docSvc := svc.NewService(projectDir)
	actual, _ := h.stores.LoadOrStore(projectKey, docSvc)
	return actual.(svc.Service)
}
