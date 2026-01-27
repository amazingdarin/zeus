package handler

import (
	"github.com/gin-gonic/gin"

	documentapi "zeus/internal/modules/document/api"
	knowledgeapi "zeus/internal/modules/knowledge/api"
	searchapi "zeus/internal/modules/knowledge/search/api"
	projectapi "zeus/internal/modules/project/api"
	"zeus/internal/service"
	"zeus/internal/service/chatrun"
	"zeus/internal/service/chatstream"
	svcopenapi "zeus/internal/service/openapi"
)

func RegisterRoutes(
	r *gin.Engine,
	storageObjectSvc service.StorageObjectService,
	assetSvc service.AssetService,
	projectSvc service.ProjectService,
	documentSvc service.DocumentService,
	knowledgeSvc service.KnowledgeService,
	searchSvc service.SearchService,
	ragSvc service.RAGService,
	summarySvc service.DocumentSummaryService,
	taskSvc service.TaskService,
	openapiIndexSvc svcopenapi.IndexService,
	modelRuntimeSvc service.ModelRuntimeService,
	providerRegistry service.ProviderRegistry,
	providerCredentialSvc service.ProviderCredentialService,
	providerConnectionSvc service.ProviderConnectionService,
	chatRunRegistry chatrun.RunRegistry,
	chatStreamSvc ChatStreamRunner,
	commandRouter chatstream.SlashRouter,
	convertSvc service.ConvertService,
) {
	storageObjectHandler := NewStorageObjectHandler(storageObjectSvc, projectSvc)
	assetHandler := NewAssetHandler(assetSvc)
	projectHandler := projectapi.NewProjectHandler(projectSvc)
	knowledgeHandler := knowledgeapi.NewKnowledgeHandler(knowledgeSvc)
	documentHandler := documentapi.NewDocumentHandler(projectSvc, documentSvc)
	searchHandler := searchapi.NewSearchHandler(searchSvc)
	ragHandler := NewRAGHandler(ragSvc, summarySvc, projectSvc, taskSvc)
	taskHandler := NewTaskHandler(taskSvc)
	summaryHandler := NewDocumentSummaryHandler(summarySvc, projectSvc)
	openapiHandler := NewOpenAPIHandler(openapiIndexSvc)
	systemHandler := NewSystemHandler()
	modelHandler := NewModelRuntimeHandler(modelRuntimeSvc)
	providerHandler := NewProviderHandler(providerRegistry, providerCredentialSvc, providerConnectionSvc)
	chatRunHandler := NewChatRunHandler(chatRunRegistry, projectSvc)
	chatStreamHandler := NewChatStreamHandler(chatRunRegistry, chatStreamSvc, projectSvc)
	commandHandler := NewCommandHandler(commandRouter, projectSvc)
	convertHandler := NewConvertHandler(convertSvc, projectSvc)

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

	// Convert
	api.POST("/projects/:project_key/convert", convertHandler.Convert)

	// Project
	api.POST("/projects", projectHandler.Create)
	api.GET("/projects", projectHandler.List)

	// Knowledge
	// api.GET("/projects/:project_key/documents", knowledgeHandler.List)
	// api.POST("/projects/:project_key/documents", knowledgeHandler.Create)
	// api.PATCH("/projects/:project_key/documents/:doc_id", knowledgeHandler.Update)
	// api.PATCH("/projects/:project_key/documents/:doc_id/move", knowledgeHandler.Move)
	// api.GET("/projects/:project_key/documents/:doc_id", knowledgeHandler.Get)

	api.GET("/projects/:project_key/documents", documentHandler.List)
	api.POST("/projects/:project_key/documents", documentHandler.Create)
	api.POST("/projects/:project_key/documents/import", documentHandler.Import)
	api.PATCH("/projects/:project_key/documents/:doc_id/move", documentHandler.Move)
	api.GET("/projects/:project_key/documents/:doc_id", documentHandler.Get)
	api.GET("/projects/:project_key/documents/:doc_id/hierarchy", documentHandler.GetHierarchy)
	api.GET("/projects/:project_key/documents/:doc_id/blocks/:block_id", documentHandler.GetBlock)

	api.GET("/projects/:project_key/documents/:doc_id/summary", summaryHandler.Get)
	api.POST("/projects/:project_key/documents/:doc_id/proposals", knowledgeHandler.CreateProposal)
	api.GET("/projects/:project_key/documents/:doc_id/proposals/:proposal_id/diff", knowledgeHandler.DiffProposal)
	api.POST("/projects/:project_key/documents/:doc_id/proposals/:proposal_id/apply", knowledgeHandler.ApplyProposal)
	api.POST("/projects/:project_key/documents/:doc_id/proposals/:proposal_id/reject", knowledgeHandler.RejectProposal)

	// OpenAPI
	api.GET("/projects/:project_key/openapi/index", openapiHandler.Index)

	// Search
	api.GET("/projects/:project_key/search", searchHandler.Search)

	// RAG
	api.POST("/projects/:project_key/rag/rebuild", ragHandler.RebuildProjectByKey)
	api.POST("/rag/rebuild/project/:project_id", ragHandler.RebuildProject)
	api.POST("/projects/:project_key/rag/rebuild/documents/:doc_id", ragHandler.RebuildDocument)

	// Chat runs
	api.POST("/projects/:project_key/chat/runs", chatRunHandler.Create)
	api.GET("/projects/:project_key/chat/runs/:run_id/stream", chatStreamHandler.Stream)

	// Commands
	api.POST("/projects/:project_key/commands", commandHandler.Execute)
	// Task
	api.GET("/tasks/:id", taskHandler.Get)

	api.GET("/model-runtimes", modelHandler.ListRuntimes)
	api.POST("/model-runtimes", modelHandler.UpsertRuntime)
	api.POST("/model-runtimes/models:refresh", modelHandler.RefreshModels)
	api.POST("/model-runtimes/test", modelHandler.TestRuntime)

	api.GET("/providers", providerHandler.ListProviders)
	api.POST("/providers/test", providerHandler.TestProvider)
	api.GET("/provider-connections", providerHandler.ListConnections)
	api.POST("/provider-connections", providerHandler.UpsertConnection)
	api.GET("/provider-connections/:id/models", providerHandler.ListConnectionModels)
	api.POST("/providers/:id/auth/api", providerHandler.StoreAPIKey)
	api.POST("/providers/:id/auth/start", providerHandler.StartDeviceCode)
	api.POST("/providers/:id/auth/poll", providerHandler.PollDeviceCode)
}
