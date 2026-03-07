package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"zeus/internal/infra/jwt"
	"zeus/internal/types"
)

// AuthMiddleware creates a JWT authentication middleware
func AuthMiddleware(jwtManager *jwt.JWTManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractToken(c)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    "UNAUTHORIZED",
				"message": "missing or invalid authorization header",
			})
			return
		}

		claims, err := jwtManager.ValidateAccessToken(token)
		if err != nil {
			status := http.StatusUnauthorized
			code := "UNAUTHORIZED"
			message := "invalid token"

			if err == jwt.ErrExpiredToken {
				code = "TOKEN_EXPIRED"
				message = "token has expired"
			}

			c.AbortWithStatusJSON(status, gin.H{
				"code":    code,
				"message": message,
			})
			return
		}

		// Set user info in context
		c.Set(string(types.CtxKeyUserID), claims.UserID)
		c.Set(string(types.CtxKeyUserEmail), claims.Email)
		c.Set(string(types.CtxKeyUserUsername), claims.Username)

		c.Next()
	}
}

// OptionalAuthMiddleware extracts user info if token is present, but doesn't require it
func OptionalAuthMiddleware(jwtManager *jwt.JWTManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractToken(c)
		if token == "" {
			c.Next()
			return
		}

		claims, err := jwtManager.ValidateAccessToken(token)
		if err != nil {
			// Token is invalid but we don't block the request
			c.Next()
			return
		}

		// Set user info in context
		c.Set(string(types.CtxKeyUserID), claims.UserID)
		c.Set(string(types.CtxKeyUserEmail), claims.Email)
		c.Set(string(types.CtxKeyUserUsername), claims.Username)

		c.Next()
	}
}

func extractToken(c *gin.Context) string {
	// Try Authorization header first
	authHeader := c.GetHeader("Authorization")
	if authHeader != "" {
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) == 2 && strings.ToLower(parts[0]) == "bearer" {
			return parts[1]
		}
	}

	// Try query parameter as fallback (for WebSocket connections)
	if token := c.Query("token"); token != "" {
		return token
	}

	return ""
}

// GetUserID extracts user ID from context
func GetUserID(c *gin.Context) string {
	if v, exists := c.Get(string(types.CtxKeyUserID)); exists {
		if id, ok := v.(string); ok {
			return id
		}
	}
	return ""
}

// GetUserEmail extracts user email from context
func GetUserEmail(c *gin.Context) string {
	if v, exists := c.Get(string(types.CtxKeyUserEmail)); exists {
		if email, ok := v.(string); ok {
			return email
		}
	}
	return ""
}

// GetUserUsername extracts username from context
func GetUserUsername(c *gin.Context) string {
	if v, exists := c.Get(string(types.CtxKeyUserUsername)); exists {
		if username, ok := v.(string); ok {
			return username
		}
	}
	return ""
}

// MustGetUserID extracts user ID from context, panics if not found
func MustGetUserID(c *gin.Context) string {
	id := GetUserID(c)
	if id == "" {
		panic("user id not found in context")
	}
	return id
}
