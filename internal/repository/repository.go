package repository

import (
	"zeus/internal/modules/project/repository"
)

// Repository ALL repo
type Repository struct {
	Project           repository.ProjectRepository
	StorageObject     StorageObjectRepository
	Task              TaskRepository
	KnowledgeFulltext KnowledgeFulltextRepository
}
