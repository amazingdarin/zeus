package handler

import (
	"github.com/gin-gonic/gin"

	"zeus/internal/service"
)

func RegisterRoutes(
	r *gin.Engine,
	storageObjectSvc service.StorageObjectService,
	assetSvc service.AssetService,
	projectSvc service.ProjectService,
	knowledgeSvc service.KnowledgeService,
	searchSvc service.SearchService,
) {
	storageObjectHandler := NewStorageObjectHandler(storageObjectSvc, projectSvc)
	assetHandler := NewAssetHandler(assetSvc)
	projectHandler := NewProjectHandler(projectSvc)
	knowledgeHandler := NewKnowledgeHandler(knowledgeSvc)
	searchHandler := NewSearchHandler(searchSvc)

	api := r.Group("/api")

	// StorageObject
	api.POST("/projects/:project_key/storage-objects", storageObjectHandler.Create)
	api.GET("/projects/:project_key/storage-objects/:storage_object_id", storageObjectHandler.GetAccess)

	// Asset
	api.POST("/projects/:project_key/assets/import", assetHandler.Import)

	// Project
	api.POST("/projects", projectHandler.Create)
	api.GET("/projects", projectHandler.List)

	// Knowledge
	api.GET("/projects/:project_key/documents", knowledgeHandler.List)
	api.POST("/projects/:project_key/documents", knowledgeHandler.Create)
	api.PATCH("/projects/:project_key/documents/:doc_id", knowledgeHandler.Update)
	api.GET("/projects/:project_key/documents/:doc_id", knowledgeHandler.Get)

	// Search
	api.GET("/projects/:project_key/search", searchHandler.Search)
}
