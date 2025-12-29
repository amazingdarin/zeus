package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/service"
)

type RawDocumentHandler struct {
	svc service.RawDocumentService
}

func NewRawDocumentHandler(svc service.RawDocumentService) *RawDocumentHandler {
	return &RawDocumentHandler{svc: svc}
}

// ListRawDocuments
// @route GET /api/raw-documents
func (h *RawDocumentHandler) ListRawDocuments(c *gin.Context) {
	var req types.ListRawDocumentsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "INVALID_QUERY",
			Message: err.Error(),
		})
		return
	}

	docs, total, err := h.svc.List(
		c.Request.Context(),
		req.BatchID,
		req.Limit,
		req.Offset,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "LIST_FAILED",
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, types.ListRawDocumentsResponse{
		Data:  docs,
		Total: total,
	})
}

// GetRawDocument
// @route GET /api/raw-documents/:doc_id
func (h *RawDocumentHandler) GetRawDocument(c *gin.Context) {
	docID := c.Param("doc_id")
	if docID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_DOC_ID",
			Message: "doc_id is required",
		})
		return
	}

	doc, err := h.svc.Get(c.Request.Context(), docID)
	if err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{
			Code:    "NOT_FOUND",
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, types.GetRawDocumentResponse{
		Data: *doc,
	})
}
