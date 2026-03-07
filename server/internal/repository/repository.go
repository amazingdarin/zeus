package repository

import (
	"zeus/internal/modules/project/repository"
)

// Repository ALL repo
type Repository struct {
	Project            repository.ProjectRepository
	Task               TaskRepository
	KnowledgeFulltext  KnowledgeFulltextRepository
	KnowledgeEmbedding KnowledgeEmbeddingRepository
}
