package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/service"
)

type SearchHandler struct {
	svc service.SearchService
}

func NewSearchHandler(svc service.SearchService) *SearchHandler {
	return &SearchHandler{svc: svc}
}

// Search
// @route GET /api/projects/:project_key/search
func (h *SearchHandler) Search(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	query := strings.TrimSpace(c.Query("q"))
	if query == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_QUERY",
			Message: "q is required",
		})
		return
	}
	if h.svc == nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "search service is required",
		})
		return
	}

	results, err := h.svc.Search(c.Request.Context(), projectKey, query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "SEARCH_FAILED",
			Message: err.Error(),
		})
		return
	}

	items := make([]types.SearchResultDTO, 0, len(results))
	for _, result := range results {
		items = append(items, types.SearchResultDTO{
			DocID:   result.DocID,
			Slug:    result.Slug,
			Title:   result.Title,
			Snippet: result.Snippet,
			BlockID: result.BlockID,
		})
	}

	c.JSON(http.StatusOK, types.SearchResponse{
		Code:    "OK",
		Message: "success",
		Data:    items,
	})
}
