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

type StorageObjectHandler struct {
	svc service.StorageObjectService
}

func NewStorageObjectHandler(svc service.StorageObjectService) *StorageObjectHandler {
	return &StorageObjectHandler{svc: svc}
}

func (h *StorageObjectHandler) Create(c *gin.Context) {
	var req types.CreateStorageObjectRequest
	if err := c.ShouldBind(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "INVALID_REQUEST",
			Message: err.Error(),
		})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_FILE",
			Message: "file is required",
		})
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "INVALID_FILE",
			Message: err.Error(),
		})
		return
	}
	defer file.Close()

	so := &domain.StorageObject{
		Source: domain.SourceInfo{
			Type:          domain.SourceType(req.SourceType),
			UploadBatchID: req.SourceUploadBatchID,
			URL:           req.SourceURL,
			ImportedFrom:  req.SourceImportedFrom,
		},
		Storage: domain.StorageInfo{
			Type: domain.StorageType(req.StorageType),

			Bucket: req.Bucket,
			Key:    req.ObjectKey,

			BasePath: req.BasePath,
			FilePath: req.FilePath,
		},
	}

	mimeType := strings.TrimSpace(req.MimeType)
	if mimeType == "" {
		mimeType = fileHeader.Header.Get("Content-Type")
	}

	err = h.svc.Create(c.Request.Context(), so, service.StoragePayload{
		Reader:    file,
		SizeBytes: fileHeader.Size,
		MimeType:  mimeType,
		Namespace: req.Namespace,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "CREATE_STORAGE_OBJECT_FAILED",
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, &types.CreateStorageObjectResponse{
		ID:        so.ID,
		CreatedAt: so.CreatedAt.Format(time.RFC3339),
	})
}
