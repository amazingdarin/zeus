package mapper

import (
	"zeus/internal/domain"
	"zeus/internal/modules/project/repository/postgres/model"
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
		RepoURL:     project.RepoURL,
		RepoBaseURL: project.RepoBaseURL,
		RepoName:    project.RepoName,
		OwnerType:   string(project.OwnerType),
		OwnerID:     project.OwnerID,
		Visibility:  string(project.Visibility),
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
		RepoURL:     project.RepoURL,
		RepoBaseURL: project.RepoBaseURL,
		RepoName:    project.RepoName,
		OwnerType:   domain.OwnerType(project.OwnerType),
		OwnerID:     project.OwnerID,
		Visibility:  domain.ProjectVisibility(project.Visibility),
		Status:      domain.ProjectStatus(project.Status),
		CreatedAt:   project.CreatedAt,
		UpdatedAt:   project.UpdatedAt,
	}
}
