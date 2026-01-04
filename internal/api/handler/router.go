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
	storageObjectHandler := NewStorageObjectHandler(storageObjectSvc, projectSvc)
	projectHandler := NewProjectHandler(projectSvc)
	documentHandler := NewDocumentHandler(projectSvc, documentSvc)

	api := r.Group("/api")

	// StorageObject
	api.POST("/projects/:project_key/storage-objects", storageObjectHandler.Create)
	api.GET("/projects/:project_key/storage-objects/:storage_object_id", storageObjectHandler.GetAccess)

	// Project
	api.POST("/projects", projectHandler.Create)
	api.GET("/projects", projectHandler.List)

	// Document
	api.GET("/projects/:project_key/documents", documentHandler.List)
	api.POST("/projects/:project_key/documents", documentHandler.Create)
	api.PUT("/projects/:project_key/documents/:document_id", documentHandler.Update)
	api.GET("/projects/:project_key/documents/:document_id", documentHandler.Get)
}
