package handler

import (
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/service"
)

type ConvertHandler struct {
	svc        service.ConvertService
	projectSvc service.ProjectService
}

func NewConvertHandler(svc service.ConvertService, projectSvc service.ProjectService) *ConvertHandler {
	return &ConvertHandler{svc: svc, projectSvc: projectSvc}
}

func (h *ConvertHandler) Convert(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "MISSING_PROJECT_KEY", Message: "project_key is required"})
		return
	}
	if h.projectSvc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "PROJECT_SERVICE_NOT_READY", Message: "project service is required"})
		return
	}
	if _, err := h.projectSvc.GetByKey(c.Request.Context(), projectKey); err != nil {
		c.JSON(http.StatusNotFound, types.ErrorResponse{Code: "PROJECT_NOT_FOUND", Message: err.Error()})
		return
	}

	from := strings.TrimSpace(c.Query("from"))
	to := strings.TrimSpace(c.Query("to"))
	if from == "" || to == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_REQUEST", Message: "from and to are required"})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "MISSING_FILE", Message: "file is required"})
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{Code: "INVALID_FILE", Message: err.Error()})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{Code: "READ_FAILED", Message: "failed to read file"})
		return
	}

	content, err := h.svc.Convert(c.Request.Context(), data, from, to)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, types.ErrorResponse{Code: "CONVERT_FAILED", Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    "OK",
		"message": "success",
		"data": gin.H{
			"content":     content,
			"output_type": strings.ToLower(to),
		},
	})
}
