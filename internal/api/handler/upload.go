package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/service"
)

type UploadHandler struct {
	svc service.UploadService
}

func NewUploadHandler(svc service.UploadService) *UploadHandler {
	return &UploadHandler{svc: svc}
}

// CreateUploadBatch
// @route POST /api/uploads
func (h *UploadHandler) CreateUploadBatch(c *gin.Context) {
	var req types.CreateUploadBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "INVALID_ARGUMENT",
			Message: err.Error(),
		})
		return
	}

	batchID, uploadURL, err := h.svc.CreateBatch(
		c.Request.Context(),
		req.SourceType,
		req.Description,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "CREATE_BATCH_FAILED",
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, types.CreateUploadBatchResponse{
		BatchID:   batchID,
		UploadURL: uploadURL,
	})
}

// UploadFile
// @route POST /api/uploads/:batch_id/files
func (h *UploadHandler) UploadFile(c *gin.Context) {
	batchID := c.Param("batch_id")
	if batchID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_BATCH_ID",
			Message: "batch_id is required",
		})
		return
	}

	var form types.UploadFileForm
	if err := c.ShouldBind(&form); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "INVALID_FORM",
			Message: err.Error(),
		})
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_FILE",
			Message: "file is required",
		})
		return
	}

	if err := h.svc.UploadFile(
		c.Request.Context(),
		batchID,
		file,
		form.RelativePath,
	); err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "UPLOAD_FILE_FAILED",
			Message: err.Error(),
		})
		return
	}

	c.Status(http.StatusNoContent)
}
