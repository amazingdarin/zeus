package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/domain"
	"zeus/internal/repository"
	"zeus/internal/service"
)

type KnowledgeHandler struct {
	svc service.KnowledgeService
}

func NewKnowledgeHandler(svc service.KnowledgeService) *KnowledgeHandler {
	return &KnowledgeHandler{svc: svc}
}

// List
// @route GET /api/projects/:project_key/documents
func (h *KnowledgeHandler) List(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	parentID := strings.TrimSpace(c.Query("parent_id"))
	if h.svc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "knowledge service is required",
		})
		return
	}

	items, err := h.svc.ListDocumentsByParent(c.Request.Context(), projectKey, parentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "LIST_DOCUMENTS_FAILED",
			Message: err.Error(),
		})
		return
	}

	list := make([]types.KnowledgeDocumentMetaDTO, 0, len(items))
	for _, item := range items {
		list = append(list, mapMetaDTOWithChild(item.Meta, item.HasChild))
	}

	c.JSON(http.StatusOK, types.KnowledgeListResponse{
		Code:    "OK",
		Message: "success",
		Data:    list,
	})
}

// Get
// @route GET /api/projects/:project_key/documents/:doc_id
func (h *KnowledgeHandler) Get(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	docID := strings.TrimSpace(c.Param("doc_id"))
	if docID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_DOCUMENT_ID",
			Message: "doc_id is required",
		})
		return
	}
	if h.svc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "knowledge service is required",
		})
		return
	}

	meta, content, err := h.svc.GetDocument(c.Request.Context(), projectKey, docID)
	if err != nil {
		if errors.Is(err, repository.ErrDocumentNotFound) {
			c.JSON(http.StatusNotFound, types.ErrorResponse{
				Code:    "DOCUMENT_NOT_FOUND",
				Message: "document not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "GET_DOCUMENT_FAILED",
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, types.KnowledgeDocumentResponse{
		Code:    "OK",
		Message: "success",
		Data:    mapDocumentDTO(meta, content),
	})
}

// Create
// @route POST /api/projects/:project_key/documents
func (h *KnowledgeHandler) Create(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	if h.svc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "knowledge service is required",
		})
		return
	}

	var req types.KnowledgeDocumentCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "INVALID_REQUEST",
			Message: err.Error(),
		})
		return
	}
	title := strings.TrimSpace(req.Meta.Title)
	if title == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_TITLE",
			Message: "title is required",
		})
		return
	}

	content, err := parseContentPayload(req.Content)
	if err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "INVALID_CONTENT",
			Message: err.Error(),
		})
		return
	}

	meta := domain.DocumentMeta{
		ID:      strings.TrimSpace(req.Meta.ID),
		Slug:    strings.TrimSpace(req.Meta.Slug),
		Title:   title,
		Parent:  strings.TrimSpace(req.Meta.Parent),
		Path:    strings.TrimSpace(req.Meta.Path),
		Status:  strings.TrimSpace(req.Meta.Status),
		DocType: strings.TrimSpace(req.Meta.DocType),
		Tags:    req.Meta.Tags,
	}

	createdMeta, createdContent, err := h.svc.CreateDocument(
		c.Request.Context(),
		projectKey,
		service.KnowledgeCreateRequest{
			Meta:    meta,
			Content: content,
		},
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "CREATE_DOCUMENT_FAILED",
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, types.KnowledgeDocumentResponse{
		Code:    "OK",
		Message: "success",
		Data:    mapDocumentDTO(createdMeta, createdContent),
	})
}

// Update
// @route PATCH /api/projects/:project_key/documents/:doc_id
func (h *KnowledgeHandler) Update(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	docID := strings.TrimSpace(c.Param("doc_id"))
	if docID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_DOCUMENT_ID",
			Message: "doc_id is required",
		})
		return
	}
	if h.svc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "knowledge service is required",
		})
		return
	}

	var req types.KnowledgeDocumentUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "INVALID_REQUEST",
			Message: err.Error(),
		})
		return
	}

	var metaPatch *domain.DocumentMeta
	if req.Meta != nil {
		metaPatch = &domain.DocumentMeta{
			ID:      strings.TrimSpace(req.Meta.ID),
			Slug:    strings.TrimSpace(req.Meta.Slug),
			Title:   strings.TrimSpace(req.Meta.Title),
			Parent:  strings.TrimSpace(req.Meta.Parent),
			Path:    strings.TrimSpace(req.Meta.Path),
			Status:  strings.TrimSpace(req.Meta.Status),
			DocType: strings.TrimSpace(req.Meta.DocType),
			Tags:    req.Meta.Tags,
		}
	}

	var contentPatch *domain.DocumentContent
	if !isJSONEmpty(req.Content) {
		content, err := parseContentPayload(req.Content)
		if err != nil {
			c.JSON(http.StatusBadRequest, types.ErrorResponse{
				Code:    "INVALID_CONTENT",
				Message: err.Error(),
			})
			return
		}
		contentPatch = &content
	}

	if metaPatch == nil && contentPatch == nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "EMPTY_UPDATE",
			Message: "meta or content is required",
		})
		return
	}

	updatedMeta, updatedContent, err := h.svc.UpdateDocument(
		c.Request.Context(),
		projectKey,
		docID,
		service.KnowledgeUpdateRequest{
			Meta:    metaPatch,
			Content: contentPatch,
		},
	)
	if err != nil {
		if errors.Is(err, repository.ErrDocumentNotFound) {
			c.JSON(http.StatusNotFound, types.ErrorResponse{
				Code:    "DOCUMENT_NOT_FOUND",
				Message: "document not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "UPDATE_DOCUMENT_FAILED",
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, types.KnowledgeDocumentResponse{
		Code:    "OK",
		Message: "success",
		Data:    mapDocumentDTO(updatedMeta, updatedContent),
	})
}

func mapMetaDTO(meta domain.DocumentMeta) types.KnowledgeDocumentMetaDTO {
	docType := strings.TrimSpace(meta.DocType)
	if docType == "" {
		docType = "document"
	}
	return types.KnowledgeDocumentMetaDTO{
		ID:        meta.ID,
		Slug:      meta.Slug,
		Title:     meta.Title,
		Parent:    meta.Parent,
		Path:      meta.Path,
		Status:    meta.Status,
		DocType:   docType,
		Tags:      meta.Tags,
		CreatedAt: meta.CreatedAt.Format(time.RFC3339),
		UpdatedAt: meta.UpdatedAt.Format(time.RFC3339),
	}
}

func mapMetaDTOWithChild(meta domain.DocumentMeta, hasChild bool) types.KnowledgeDocumentMetaDTO {
	dto := mapMetaDTO(meta)
	dto.HasChild = hasChild
	return dto
}

func mapDocumentDTO(
	meta domain.DocumentMeta,
	content domain.DocumentContent,
) types.KnowledgeDocumentDTO {
	return types.KnowledgeDocumentDTO{
		Meta: mapMetaDTO(meta),
		Content: types.KnowledgeDocumentContentDTO{
			Meta:    content.Meta,
			Content: content.Content,
		},
	}
}

func parseContentPayload(raw json.RawMessage) (domain.DocumentContent, error) {
	if isJSONEmpty(raw) {
		return domain.DocumentContent{}, fmt.Errorf("content is required")
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return domain.DocumentContent{}, fmt.Errorf("parse content: %w", err)
	}
	if isTipTapDoc(payload) {
		return domain.DocumentContent{
			Meta:    map[string]interface{}{},
			Content: payload,
		}, nil
	}
	if hasContentPayload(payload) {
		meta, err := parseMetaNode(payload["meta"])
		if err != nil {
			return domain.DocumentContent{}, err
		}
		contentNode, err := parseContentNode(payload["content"])
		if err != nil {
			return domain.DocumentContent{}, err
		}
		return domain.DocumentContent{
			Meta:    meta,
			Content: contentNode,
		}, nil
	}
	return domain.DocumentContent{
		Meta:    map[string]interface{}{},
		Content: payload,
	}, nil
}

func hasContentPayload(payload map[string]interface{}) bool {
	if payload == nil {
		return false
	}
	if _, ok := payload["content"]; ok {
		return true
	}
	_, ok := payload["meta"]
	return ok
}

func isTipTapDoc(payload map[string]interface{}) bool {
	if payload == nil {
		return false
	}
	_, ok := payload["type"]
	return ok
}

func parseMetaNode(node interface{}) (map[string]interface{}, error) {
	if node == nil {
		return map[string]interface{}{}, nil
	}
	meta, ok := node.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("meta must be an object")
	}
	return meta, nil
}

func parseContentNode(node interface{}) (map[string]interface{}, error) {
	if node == nil {
		return map[string]interface{}{}, nil
	}
	content, ok := node.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("content must be an object")
	}
	return content, nil
}

func isJSONEmpty(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return true
	}
	return bytes.Equal(trimmed, []byte("null"))
}
