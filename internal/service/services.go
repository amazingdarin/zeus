package service

import (
	"zeus/internal/infra/embedding"
	documentservice "zeus/internal/modules/document/service"
	service2 "zeus/internal/modules/project/service"
)

// Services aggregates application services.
type Services struct {
	StorageObject      StorageObjectService
	Asset              documentservice.AssetService
	Project            service2.ProjectService
	Knowledge          KnowledgeService
	Document           documentservice.DocumentService
	Search             SearchService
	RAG                RAGService
	Summary            DocumentSummaryService
	Task               TaskService
	ModelRuntime       ModelRuntimeService
	ProviderRegistry   ProviderRegistry
	ProviderCredential ProviderCredentialService
	ProviderConnection ProviderConnectionService
	Convert            ConvertService
	RuntimeResolver    embedding.ModelRuntimeResolver
}
