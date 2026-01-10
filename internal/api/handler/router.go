package handler

import (
	"github.com/gin-gonic/gin"

	"zeus/internal/service"
	svcopenapi "zeus/internal/service/openapi"
)

func RegisterRoutes(
	r *gin.Engine,
	storageObjectSvc service.StorageObjectService,
	assetSvc service.AssetService,
	projectSvc service.ProjectService,
	knowledgeSvc service.KnowledgeService,
	searchSvc service.SearchService,
	openapiIndexSvc svcopenapi.IndexService,
	modelProviderSvc service.ModelProviderService,
	modelScenarioSvc service.ModelScenarioService,
) {
	storageObjectHandler := NewStorageObjectHandler(storageObjectSvc, projectSvc)
	assetHandler := NewAssetHandler(assetSvc)
	projectHandler := NewProjectHandler(projectSvc)
	knowledgeHandler := NewKnowledgeHandler(knowledgeSvc)
	searchHandler := NewSearchHandler(searchSvc)
	openapiHandler := NewOpenAPIHandler(openapiIndexSvc)
	systemHandler := NewSystemHandler()
	modelHandler := NewModelProviderHandler(modelProviderSvc, modelScenarioSvc)

	api := r.Group("/api")

	// System
	api.GET("/system", systemHandler.Get)

	// StorageObject
	api.POST("/projects/:project_key/storage-objects", storageObjectHandler.Create)
	api.GET("/projects/:project_key/storage-objects/:storage_object_id", storageObjectHandler.GetAccess)

	// Asset
	api.POST("/projects/:project_key/assets/import", assetHandler.Import)
	api.GET("/projects/:project_key/assets/:asset_id/kind", assetHandler.Kind)
	api.GET("/projects/:project_key/assets/:asset_id/content", assetHandler.Content)

	// Project
	api.POST("/projects", projectHandler.Create)
	api.GET("/projects", projectHandler.List)

	// Knowledge
	api.GET("/projects/:project_key/documents", knowledgeHandler.List)
	api.POST("/projects/:project_key/documents", knowledgeHandler.Create)
	api.PATCH("/projects/:project_key/documents/:doc_id", knowledgeHandler.Update)
	api.PATCH("/projects/:project_key/documents/:doc_id/move", knowledgeHandler.Move)
	api.GET("/projects/:project_key/documents/:doc_id", knowledgeHandler.Get)

	// OpenAPI
	api.GET("/projects/:project_key/openapi/index", openapiHandler.Index)

	// Search
	api.GET("/projects/:project_key/search", searchHandler.Search)

	// Model Provider
	api.POST("/model-providers", modelHandler.CreateProvider)
	api.GET("/model-providers", modelHandler.ListProviders)
	api.GET("/model-providers/:id/models", modelHandler.ListProviderModels)

	// Model Scenario
	api.POST("/model-scenarios", modelHandler.ConfigureScenario)
	api.GET("/model-scenarios", modelHandler.ListScenarios)
}
