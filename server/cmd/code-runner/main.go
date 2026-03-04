package main

import (
	"context"
	"strings"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"

	"zeus/internal/app"
	"zeus/internal/config"
	codeexecapi "zeus/internal/modules/codeexec/api"
	codeexecrepo "zeus/internal/modules/codeexec/repository/postgres"
	codeexecsvc "zeus/internal/modules/codeexec/service"
)

func main() {
	ctx := context.Background()
	app.InitLogger()
	app.InitConfig(ctx)
	db := app.InitDB(ctx)

	repo := codeexecrepo.NewCodeRunRepository(db)
	runtime := codeexecsvc.NewLocalRuntimeExecutor()
	handler := codeexecapi.NewHandler(repo, runtime, codeexecapi.HandlerOptions{
		DefaultTimeoutSecond: config.AppConfig.CodeRunner.DefaultTimeoutSecond,
		MaxOutputBytes:       config.AppConfig.CodeRunner.MaxOutputBytes,
	})

	router := gin.New()
	router.Use(gin.Recovery())
	codeexecapi.RegisterInternalRoutes(router, config.AppConfig.CodeRunner.InternalToken, handler)
	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	addr := strings.TrimSpace(config.AppConfig.CodeRunner.Addr)
	if addr == "" {
		addr = ":8091"
	}
	log.WithField("addr", addr).Info("code-runner starting")
	if err := router.Run(addr); err != nil {
		log.WithError(err).Fatal("code-runner exited")
	}
}
