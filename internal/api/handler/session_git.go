package handler

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"zeus/internal/infra/gitclient"
)

var sessionGitManager *gitclient.SessionGitManager

func SetSessionGitManager(manager *gitclient.SessionGitManager) {
	sessionGitManager = manager
}

func GetSessionGitClientFromGin(
	c *gin.Context,
	projectKey string,
) (*gitclient.SessionGitClient, error) {
	if sessionGitManager == nil {
		return nil, fmt.Errorf("session git manager is not configured")
	}
	if c == nil {
		return nil, fmt.Errorf("gin context is required")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return nil, fmt.Errorf("project_key is required")
	}

	value, ok := c.Get("session_id")
	if !ok {
		return nil, fmt.Errorf("session_id is required")
	}
	sessionID, ok := value.(string)
	if !ok || strings.TrimSpace(sessionID) == "" {
		return nil, fmt.Errorf("session_id is required")
	}
	return sessionGitManager.Get(sessionID, projectKey)
}
