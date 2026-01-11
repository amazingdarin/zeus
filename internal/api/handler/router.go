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
	ragSvc service.RAGService,
	summarySvc service.DocumentSummaryService,
	openapiIndexSvc svcopenapi.IndexService,
	modelRuntimeSvc service.ModelRuntimeService,
) {
	storageObjectHandler := NewStorageObjectHandler(storageObjectSvc, projectSvc)
	assetHandler := NewAssetHandler(assetSvc)
	projectHandler := NewProjectHandler(projectSvc)
	knowledgeHandler := NewKnowledgeHandler(knowledgeSvc)
	searchHandler := NewSearchHandler(searchSvc)
	ragHandler := NewRAGHandler(ragSvc, summarySvc, projectSvc)
	summaryHandler := NewDocumentSummaryHandler(summarySvc, projectSvc)
	openapiHandler := NewOpenAPIHandler(openapiIndexSvc)
	systemHandler := NewSystemHandler()
	modelHandler := NewModelRuntimeHandler(modelRuntimeSvc)

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
	api.GET("/projects/:project_key/documents/:doc_id/summary", summaryHandler.Get)

	// OpenAPI
	api.GET("/projects/:project_key/openapi/index", openapiHandler.Index)

	// Search
	api.GET("/projects/:project_key/search", searchHandler.Search)

	// RAG
	api.POST("/rag/rebuild/project/:project_id", ragHandler.RebuildProject)
	api.POST("/projects/:project_key/rag/rebuild/documents/:doc_id", ragHandler.RebuildDocument)

	// Model Runtime
	api.GET("/model-runtimes", modelHandler.ListRuntimes)
	api.POST("/model-runtimes", modelHandler.UpsertRuntime)
	api.POST("/model-runtimes/models:refresh", modelHandler.RefreshModels)
	api.POST("/model-runtimes/test", modelHandler.TestRuntime)
}
