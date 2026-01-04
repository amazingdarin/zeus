package project

import (
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"zeus/internal/infra/ingestion"

	"github.com/google/uuid"

	"zeus/internal/domain"
	"zeus/internal/repository"
	"zeus/internal/service"
)

type Service struct {
	projectRepo  repository.ProjectRepository
	documentRepo repository.DocumentRepository
	documentSvc  service.DocumentService

	ingestion ingestion.FileIngestionService

	storageObjectSvc service.StorageObjectService
}

func NewService(
	projectRepo repository.ProjectRepository,
	documentRepo repository.DocumentRepository,
	ingestion ingestion.FileIngestionService,
	storageObjectSvc service.StorageObjectService,
	documentSvc service.DocumentService) *Service {
	return &Service{
		projectRepo:      projectRepo,
		documentRepo:     documentRepo,
		ingestion:        ingestion,
		storageObjectSvc: storageObjectSvc,
		documentSvc:      documentSvc,
	}
}

func (s *Service) Create(ctx context.Context, project *domain.Project) error {
	if project == nil {
		return fmt.Errorf("project is required")
	}
	if strings.TrimSpace(project.ID) == "" {
		project.ID = uuid.NewString()
	}
	project.Key = strings.TrimSpace(project.Key)
	project.RepoName = strings.TrimSpace(project.RepoName)
	project.RepoURL = strings.TrimSpace(project.RepoURL)
	if project.RepoName == "" {
		project.RepoName = buildRepoName(project.Key)
	}
	if project.RepoURL == "" {
		project.RepoURL = buildRepoURL(project.RepoName)
	}

	now := time.Now()
	project.CreatedAt = now
	project.UpdatedAt = now

	if err := project.Validate(); err != nil {
		return err
	}

	if err := s.projectRepo.Insert(ctx, project); err != nil {
		return fmt.Errorf("insert project: %w", err)
	}

	if err := s.initProject(ctx, project); err != nil {
		return fmt.Errorf("init project: %w", err)
	}
	return nil
}

func (s *Service) List(ctx context.Context) ([]*domain.Project, error) {
	projects, _, err := s.projectRepo.List(ctx, repository.ProjectFilter{}, repository.ProjectOption{})
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	return projects, nil
}

func (s *Service) GetByKey(ctx context.Context, key string) (*domain.Project, error) {
	if s.projectRepo == nil {
		return nil, fmt.Errorf("project repository is required")
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return nil, fmt.Errorf("project key is required")
	}
	project, err := s.projectRepo.FindByKey(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("find project: %w", err)
	}
	return project, nil
}

func (s *Service) initProject(ctx context.Context, project *domain.Project) error {
	if project == nil {
		return fmt.Errorf("project is required")
	}
	if s.ingestion == nil {
		return fmt.Errorf("ingestion service is required")
	}
	if s.storageObjectSvc == nil {
		return fmt.Errorf("storage object service is required")
	}
	if s.documentRepo == nil {
		return fmt.Errorf("document repository is required")
	}

	const projectDocDir = "doc"
	if _, err := s.ingestion.CreateDirectory(ctx, ingestion.DirectoryInput{
		Namespace: project.ID,
		Path:      projectDocDir,
	}); err != nil {
		return fmt.Errorf("create project directory: %w", err)
	}

	type initDocSpec struct {
		filename string
		title    string
		docType  domain.DocumentType
		order    int
	}

	specs := []initDocSpec{
		{
			filename: "overview",
			title:    "Overview",
			docType:  domain.DocumentTypeOverview,
			order:    1,
		},
		{
			filename: "project",
			title:    "Project Documents",
			docType:  domain.DocumentTypeOrigin,
			order:    2,
		},
		{
			filename: "requirement",
			title:    "Requirement Documents",
			docType:  domain.DocumentTypeRequirement,
			order:    3,
		},
	}

	for _, spec := range specs {
		filePath := filepath.Join("resource", "initdoc", spec.filename)
		file, size, err := openInitFile(filePath)
		if err != nil {
			return err
		}
		so := &domain.StorageObject{
			ID:        uuid.NewString(),
			ProjectID: project.ID,
			Source: domain.SourceInfo{
				Type:         domain.StorageObjectSourceTypeSystem,
				ImportedFrom: filePath,
			},
			Storage: domain.StorageInfo{
				Type: domain.StorageTypeS3,
				Key:  path.Join(projectDocDir, spec.filename),
			},
		}

		payload := service.StoragePayload{
			Reader:    file,
			SizeBytes: size,
			MimeType:  "text/plain",
			Namespace: project.ID,
		}

		if err := s.storageObjectSvc.Create(ctx, so, payload); err != nil {
			file.Close()
			return fmt.Errorf("create storage object: %w", err)
		}
		file.Close()

		now := time.Now()
		document := &domain.Document{
			ID:            uuid.NewString(),
			ProjectID:     project.ID,
			Type:          spec.docType,
			Title:         spec.title,
			Description:   buildDocumentDescription(project.Description, spec.title),
			Status:        domain.DocumentStatusActive,
			Path:          path.Join("/", projectDocDir, spec.filename),
			Order:         spec.order,
			StorageObject: so,
			CreatedAt:     now,
			UpdatedAt:     now,
		}

		if err := s.documentRepo.Save(ctx, document); err != nil {
			return fmt.Errorf("save initial document: %w", err)
		}
	}

	return nil
}

func openInitFile(filePath string) (io.ReadCloser, int64, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, 0, fmt.Errorf("open init file: %w", err)
	}
	stat, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, 0, fmt.Errorf("stat init file: %w", err)
	}
	return file, stat.Size(), nil
}

func buildDocumentDescription(projectDescription, title string) string {
	projectDescription = strings.TrimSpace(projectDescription)
	if projectDescription == "" {
		return title
	}
	return fmt.Sprintf("%s %s", projectDescription, title)
}

func buildRepoName(projectKey string) string {
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return ""
	}
	return fmt.Sprintf("zeus-%s.git", projectKey)
}

func buildRepoURL(repoName string) string {
	repoName = strings.TrimSpace(repoName)
	if repoName == "" {
		return ""
	}
	return repoName
}

var _ service.ProjectService = (*Service)(nil)
