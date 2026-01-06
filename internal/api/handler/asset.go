package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/service"
)

type AssetHandler struct {
	svc service.AssetService
}

func NewAssetHandler(svc service.AssetService) *AssetHandler {
	return &AssetHandler{svc: svc}
}

// Import
// @route POST /api/projects/:project_key/assets/import
func (h *AssetHandler) Import(c *gin.Context) {
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
			Message: "asset service is required",
		})
		return
	}

	form, err := c.MultipartForm()
	if err != nil || form == nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "INVALID_MULTIPART",
			Message: "multipart form is required",
		})
		return
	}

	fileHeaders, ok := form.File["file"]
	if !ok || len(fileHeaders) == 0 {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_FILE",
			Message: "file is required",
		})
		return
	}
	totalFiles := 0
	for _, items := range form.File {
		totalFiles += len(items)
	}
	if totalFiles != 1 || len(fileHeaders) != 1 {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MULTIPLE_FILES",
			Message: "only one file is allowed",
		})
		return
	}

	fileHeader := fileHeaders[0]
	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "OPEN_FILE_FAILED",
			Message: "unable to open file",
		})
		return
	}
	defer file.Close()

	filename := strings.TrimSpace(c.PostForm("filename"))
	if filename == "" {
		filename = fileHeader.Filename
	}
	mime := strings.TrimSpace(c.PostForm("mime"))
	if mime == "" {
		mime = fileHeader.Header.Get("Content-Type")
	}
	size := parseSize(c.PostForm("size"))
	if size <= 0 && fileHeader.Size > 0 {
		size = fileHeader.Size
	}

	assetID, err := h.svc.ImportFile(
		c.Request.Context(),
		projectKey,
		filename,
		mime,
		size,
		file,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "IMPORT_ASSET_FAILED",
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, types.AssetImportResponse{
		Code:    "OK",
		Message: "success",
		Data: types.AssetImportResult{
			AssetID:  assetID,
			Filename: filename,
			Mime:     mime,
			Size:     size,
		},
	})
}

// Kind
// @route GET /api/projects/:project_key/assets/:asset_id/kind
func (h *AssetHandler) Kind(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	assetID := strings.TrimSpace(c.Param("asset_id"))
	if assetID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_ASSET_ID",
			Message: "asset_id is required",
		})
		return
	}
	if h.svc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "asset service is required",
		})
		return
	}

	result, err := h.svc.GetKind(c.Request.Context(), projectKey, assetID)
	if err != nil {
		status := http.StatusInternalServerError
		code := "GET_ASSET_KIND_FAILED"
		if errors.Is(err, service.ErrAssetNotFound) {
			status = http.StatusNotFound
			code = "ASSET_NOT_FOUND"
		}
		c.JSON(status, types.ErrorResponse{
			Code:    code,
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, types.AssetKindResponse{
		Code:    "OK",
		Message: "success",
		Data: types.AssetKindData{
			Kind:           string(result.Kind),
			OpenAPIVersion: result.OpenAPIVersion,
		},
	})
}

// Content
// @route GET /api/projects/:project_key/assets/:asset_id/content
func (h *AssetHandler) Content(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	assetID := strings.TrimSpace(c.Param("asset_id"))
	if assetID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_ASSET_ID",
			Message: "asset_id is required",
		})
		return
	}
	if h.svc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "asset service is required",
		})
		return
	}

	meta, data, err := h.svc.GetContent(c.Request.Context(), projectKey, assetID)
	if err != nil {
		status := http.StatusInternalServerError
		code := "GET_ASSET_CONTENT_FAILED"
		if errors.Is(err, service.ErrAssetNotFound) {
			status = http.StatusNotFound
			code = "ASSET_NOT_FOUND"
		}
		c.JSON(status, types.ErrorResponse{
			Code:    code,
			Message: err.Error(),
		})
		return
	}

	contentType := strings.TrimSpace(meta.Mime)
	if contentType == "" {
		contentType = "text/plain; charset=utf-8"
	} else if strings.HasPrefix(contentType, "text/") ||
		strings.Contains(contentType, "json") ||
		strings.Contains(contentType, "yaml") {
		if !strings.Contains(strings.ToLower(contentType), "charset") {
			contentType = contentType + "; charset=utf-8"
		}
	}

	c.Data(http.StatusOK, contentType, data)
}

func parseSize(raw string) int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0
	}
	return value
}
