package middleware

import (
	"time"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

func LoggerMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		method := c.Request.Method
		path := c.Request.URL.Path
		clientIP := c.ClientIP()

		c.Next()

		latency := time.Since(start)
		status := c.Writer.Status()
		entry := log.WithFields(log.Fields{
			"method":  method,
			"path":    path,
			"status":  status,
			"latency": latency.String(),
			"ip":      clientIP,
		})
		if len(c.Errors) > 0 {
			entry.WithField("errors", c.Errors.String()).Error("request")
			return
		}
		if status >= 400 {
			entry.Warn("request")
			return
		}
		entry.Info("request")
	}
}
