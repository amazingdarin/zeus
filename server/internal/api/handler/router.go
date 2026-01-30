package handler

import (
	documentservice "zeus/internal/modules/document/service"
	"zeus/internal/modules/document/service/importer"
	service2 "zeus/internal/modules/project/service"

	"github.com/gin-gonic/gin"

	documentapi "zeus/internal/modules/document/api"
	projectapi "zeus/internal/modules/project/api"
)

func RegisterRoutes(
	r *gin.Engine,
	assetSvc documentservice.AssetService,
	projectSvc service2.ProjectService,
	documentSvc documentservice.DocumentService,
	gitImporter *importer.GitImporter,
) {
	assetHandler := documentapi.NewAssetHandler(assetSvc)
	projectHandler := projectapi.NewProjectHandler(projectSvc)
	documentHandler := documentapi.NewDocumentHandler(projectSvc, documentSvc, gitImporter)
	systemHandler := projectapi.NewSystemHandler()

	api := r.Group("/api")

	// System
	api.GET("/system", systemHandler.Get)

	// Asset
	api.POST("/projects/:project_key/assets/import", assetHandler.Import)
	api.GET("/projects/:project_key/assets/:asset_id/kind", assetHandler.Kind)
	api.GET("/projects/:project_key/assets/:asset_id/content", assetHandler.Content)

	// Project
	api.POST("/projects", projectHandler.Create)
	api.GET("/projects", projectHandler.List)

	api.GET("/projects/:project_key/documents", documentHandler.List)
	api.POST("/projects/:project_key/documents", documentHandler.Create)
	api.POST("/projects/:project_key/documents/import", documentHandler.Import)
	api.POST("/projects/:project_key/documents/import-git", documentHandler.ImportGit)
	api.POST("/projects/:project_key/documents/fetch-url", documentHandler.FetchURL)
	api.PATCH("/projects/:project_key/documents/:doc_id/move", documentHandler.Move)
	api.GET("/projects/:project_key/documents/:doc_id", documentHandler.Get)
	api.GET("/projects/:project_key/documents/:doc_id/hierarchy", documentHandler.GetHierarchy)
	api.GET("/projects/:project_key/documents/:doc_id/blocks/:block_id", documentHandler.GetBlock)
}
