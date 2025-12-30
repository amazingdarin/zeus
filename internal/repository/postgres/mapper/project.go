package mapper

import (
	"zeus/internal/domain"
	"zeus/internal/repository/postgres/model"
)

func ProjectFromDomain(project *domain.Project) *model.Project {
	if project == nil {
		return nil
	}
	return &model.Project{
		ID:          project.ID,
		Key:         project.Key,
		Name:        project.Name,
		Description: project.Description,
		Status:      string(project.Status),
		CreatedAt:   project.CreatedAt,
		UpdatedAt:   project.UpdatedAt,
	}
}

func ProjectToDomain(project *model.Project) *domain.Project {
	if project == nil {
		return nil
	}
	return &domain.Project{
		ID:          project.ID,
		Key:         project.Key,
		Name:        project.Name,
		Description: project.Description,
		Status:      domain.ProjectStatus(project.Status),
		CreatedAt:   project.CreatedAt,
		UpdatedAt:   project.UpdatedAt,
	}
}
