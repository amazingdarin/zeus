package middleware

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"zeus/internal/infra/session"
)

const sessionCookieName = "zeus_session_id"

// SessionMiddleware attaches a server-side session to each request.
// It keeps Git session isolation keyed by session_id without coupling to auth.
func SessionMiddleware(sm *session.SessionManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		if sm == nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"code":    "SESSION_NOT_READY",
				"message": "session manager is required",
			})
			return
		}

		sessionID, err := c.Cookie(sessionCookieName)
		if err != nil || sessionID == "" {
			sessionID = session.NewSessionID()
			sess, createErr := sm.Create(sessionID)
			if createErr != nil {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
					"code":    "SESSION_CREATE_FAILED",
					"message": createErr.Error(),
				})
				return
			}
			ctx := session.WithSession(c.Request.Context(), sess)
			c.Request = c.Request.WithContext(ctx)
			c.Set("session", sess)
			c.Set("session_id", sessionID)
			setSessionCookie(c, sessionID)
			c.Next()
			return
		}

		sess, ok := sm.Get(sessionID)
		if !ok {
			sess, err = sm.Create(sessionID)
			if err != nil {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
					"code":    "SESSION_CREATE_FAILED",
					"message": err.Error(),
				})
				return
			}
			setSessionCookie(c, sessionID)
		}

		sess.LastSeen = time.Now()
		ctx := session.WithSession(c.Request.Context(), sess)
		c.Request = c.Request.WithContext(ctx)
		c.Set("session", sess)
		c.Set("session_id", sessionID)
		c.Next()
	}
}

func setSessionCookie(c *gin.Context, sessionID string) {
	if c == nil {
		return
	}
	c.SetCookie(sessionCookieName, sessionID, int(time.Hour.Seconds()), "/", "", false, true)
}
