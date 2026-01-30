package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
)

type SystemHandler struct{}

func NewSystemHandler() *SystemHandler {
	return &SystemHandler{}
}

// Get
// @route GET /api/system
func (h *SystemHandler) Get(c *gin.Context) {
	c.JSON(http.StatusOK, types.SystemResponse{
		Code:    "OK",
		Message: "success",
	})
}
