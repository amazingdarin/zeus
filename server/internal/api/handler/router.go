package handler

import (
	service2 "zeus/internal/modules/project/service"

	"github.com/gin-gonic/gin"

	projectapi "zeus/internal/modules/project/api"
)

func RegisterRoutes(
	r *gin.Engine,
	projectSvc service2.ProjectService,
) {
	projectHandler := projectapi.NewProjectHandler(projectSvc)
	systemHandler := projectapi.NewSystemHandler()

	api := r.Group("/api")

	// System
	api.GET("/system", systemHandler.Get)

	// Project (multi-tenant management)
	api.POST("/projects", projectHandler.Create)
	api.GET("/projects", projectHandler.List)
}
