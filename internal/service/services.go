package service

import "zeus/internal/infra/embedding"

// Services aggregates application services.
type Services struct {
	StorageObject      StorageObjectService
	Asset              AssetService
	Project            ProjectService
	Knowledge          KnowledgeService
	Document           DocumentService
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
