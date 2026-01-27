package repository

import (
	"zeus/internal/modules/project/repository"
	"zeus/internal/repository/ragsummary"
)

// Repository ALL repo
type Repository struct {
	Project                 repository.ProjectRepository
	StorageObject           StorageObjectRepository
	ModelRuntime            ModelRuntimeRepository
	ProviderConnection      ProviderConnectionRepository
	ProviderCredential      ProviderCredentialRepository
	DocumentSummary         ragsummary.DocumentSummaryRepository
	Task                    TaskRepository
	KnowledgeChangeProposal KnowledgeChangeProposalRepository
	Knowledge               KnowledgeRepository
	Document                DocumentRepository
}
