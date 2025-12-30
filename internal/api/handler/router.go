package handler

import (
	"github.com/gin-gonic/gin"

	"zeus/internal/service"
)

func RegisterRoutes(
	r *gin.Engine,
	storageObjectSvc service.StorageObjectService,
	documentSvc service.DocumentService,
	projectSvc service.ProjectService,
) {
	storageObjectHandler := NewStorageObjectHandler(storageObjectSvc)
	projectHandler := NewProjectHandler(projectSvc)

	api := r.Group("/api")

	// StorageObject
	api.POST("/storage-objects", storageObjectHandler.Create)

	// Project
	api.POST("/projects", projectHandler.CreateProject)
	api.GET("/projects", projectHandler.ListProjects)
}
