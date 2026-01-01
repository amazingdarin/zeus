package handler

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/domain"
	"zeus/internal/service"
	storageobject "zeus/internal/service/storage_object"
)

type StorageObjectHandler struct {
	svc        service.StorageObjectService
	projectSvc service.ProjectService
}

func NewStorageObjectHandler(
	svc service.StorageObjectService,
	projectSvc service.ProjectService,
) *StorageObjectHandler {
	return &StorageObjectHandler{svc: svc, projectSvc: projectSvc}
}

// Create
// @route POST /api/projects/{project_key}/storage-objects
func (h *StorageObjectHandler) Create(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	if h.projectSvc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "PROJECT_SERVICE_NOT_READY",
			Message: "project service is required",
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
		ProjectID: project.ID,
		Source: domain.SourceInfo{
			Type:          domain.StorageObjectSourceType(req.SourceType),
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
		Namespace: project.ID,
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

// GetAccess
// @route GET /api/projects/{project_key}/storage-objects/{storage_object_id}
func (h *StorageObjectHandler) GetAccess(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	storageObjectID := strings.TrimSpace(c.Param("storage_object_id"))
	if storageObjectID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_STORAGE_OBJECT_ID",
			Message: "storage_object_id is required",
		})
		return
	}
	if h.projectSvc == nil || h.svc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "storage object service is required",
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

	access, obj, err := h.svc.GetAccess(c.Request.Context(), project.ID, storageObjectID)
	if err != nil {
		status := http.StatusInternalServerError
		code := "GET_ACCESS_FAILED"
		if errors.Is(err, storageobject.ErrStorageObjectNotFound) ||
			errors.Is(err, storageobject.ErrStorageObjectProjectMismatch) {
			status = http.StatusNotFound
			code = "STORAGE_OBJECT_NOT_FOUND"
		}
		c.JSON(status, types.ErrorResponse{
			Code:    code,
			Message: err.Error(),
		})
		return
	}

	downloadType := "presigned_url"
	if access.Type != "" && access.Type != "PresignedURL" {
		downloadType = strings.ToLower(access.Type)
	}

	c.JSON(http.StatusOK, types.GetStorageObjectAccessResponse{
		StorageObjectID: obj.ID,
		MimeType:        obj.MimeType,
		SizeBytes:       obj.SizeBytes,
		Download: types.StorageObjectDownloadDTO{
			Type:      downloadType,
			URL:       access.URL,
			ExpiresAt: access.ExpiresAt.Format(time.RFC3339),
		},
	})
}
