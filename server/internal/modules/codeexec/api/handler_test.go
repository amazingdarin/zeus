package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func newTokenProtectedHandler(token string) http.Handler {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/internal/code-exec/execute", tokenGuard(token), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"code": "OK"})
	})
	return router
}

func TestInternalTokenMiddleware(t *testing.T) {
	handler := newTokenProtectedHandler("runner-token")
	req := httptest.NewRequest(http.MethodPost, "/internal/code-exec/execute", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", resp.Code)
	}
}
