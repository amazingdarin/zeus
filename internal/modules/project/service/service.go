package project

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"zeus/internal/config"
	"zeus/internal/domain"
	"zeus/internal/infra/gitadmin"
	"zeus/internal/infra/gitclient"
	projectrepo "zeus/internal/modules/project/repository"
	"zeus/internal/repository"
	"zeus/internal/service"
)

type Service struct {
	projectRepo      projectrepo.ProjectRepository
	gitAdmin         gitadmin.GitAdmin
	gitClientManager *gitclient.GitClientManager
}

func NewService(
	repos repository.Repository,
	gitAdmin gitadmin.GitAdmin,
	gitClientManager *gitclient.GitClientManager,
) *Service {
	return &Service{
		projectRepo:      repos.Project,
		gitAdmin:         gitAdmin,
		gitClientManager: gitClientManager,
	}
}

func (s *Service) Create(ctx context.Context, project *domain.Project) error {
	if s == nil || s.projectRepo == nil {
		return fmt.Errorf("project service not initialized")
	}
	if project == nil {
		return fmt.Errorf("project is required")
	}
	if strings.TrimSpace(project.ID) == "" {
		project.ID = uuid.NewString()
	}
	project.Key = strings.TrimSpace(project.Key)
	project.RepoName = strings.TrimSpace(project.RepoName)
	project.RepoURL = strings.TrimSpace(project.RepoURL)
	project.RepoBaseURL = strings.TrimSpace(project.RepoBaseURL)
	if project.RepoName == "" {
		project.RepoName = buildRepoName(project.Key)
	}
	if project.RepoBaseURL == "" {
		project.RepoBaseURL = s.buildRepoBaseURL()
	}
	project.RepoURL = s.buildRepoURL(project.RepoBaseURL, project.RepoName)

	now := s.nowTime()
	project.Status = domain.ProjectStatusCreating
	project.CreatedAt = now
	project.UpdatedAt = now

	if err := project.Validate(); err != nil {
		return err
	}

	if err := s.projectRepo.Insert(ctx, project); err != nil {
		return fmt.Errorf("insert project: %w", err)
	}

	if err := s.initRepo(ctx, project); err != nil {
		_ = s.markProjectFailed(ctx, project)
		return fmt.Errorf("init repo: %w", err)
	}

	project.Status = domain.ProjectStatusActive
	project.UpdatedAt = s.nowTime()
	if err := s.projectRepo.Update(ctx, project); err != nil {
		return fmt.Errorf("update project: %w", err)
	}
	return nil
}

func (s *Service) List(ctx context.Context) ([]*domain.Project, error) {
	projects, _, err := s.projectRepo.List(ctx, projectrepo.ProjectFilter{}, projectrepo.ProjectOption{})
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

func (s *Service) initRepo(ctx context.Context, project *domain.Project) error {
	if project == nil {
		return fmt.Errorf("project is required")
	}
	if s.gitAdmin == nil {
		return fmt.Errorf("git admin is required")
	}
	if s.gitClientManager == nil {
		return fmt.Errorf("git client manager is required")
	}
	branch := s.defaultBranch()

	repoURL, err := s.gitAdmin.CreateBareRepo(ctx, project.RepoName)
	if err != nil {
		return fmt.Errorf("create bare repo: %w", err)
	}
	if repoURL != "" {
		project.RepoURL = repoURL
	}

	workdir := filepath.Join(s.repoRoot(), project.Key)
	if err := os.MkdirAll(workdir, 0o755); err != nil {
		return fmt.Errorf("create repo root: %w", err)
	}

	handle, err := s.gitClientManager.Get(gitclient.GitKey(project.Key), project.RepoName)
	if err != nil {
		return fmt.Errorf("get git client: %w", err)
	}
	defer handle.Close()

	client := handle.Client()
	if client == nil {
		return fmt.Errorf("git client is required")
	}
	if err := client.EnsureReady(ctx); err != nil {
		return err
	}
	if err := s.writeRepoScaffold(workdir, project); err != nil {
		return err
	}
	if err := client.Commit(ctx, fmt.Sprintf("docs: init %s", project.Key)); err != nil {
		return fmt.Errorf("commit init: %w", err)
	}
	if err := client.Push(ctx, "origin", branch); err != nil {
		return fmt.Errorf("push init: %w", err)
	}
	return nil
}

func (s *Service) writeRepoScaffold(workdir string, project *domain.Project) error {
	if err := os.MkdirAll(filepath.Join(workdir, "docs"), 0o755); err != nil {
		return fmt.Errorf("create docs dir: %w", err)
	}
	if err := os.MkdirAll(filepath.Join(workdir, ".zeus"), 0o755); err != nil {
		return fmt.Errorf("create .zeus dir: %w", err)
	}

	readme := fmt.Sprintf("# %s\n\nProject Key: %s\n", project.Name, project.Key)
	if err := os.WriteFile(filepath.Join(workdir, "README.md"), []byte(readme), 0o644); err != nil {
		return fmt.Errorf("write README: %w", err)
	}

	meta := map[string]interface{}{
		"id":            project.ID,
		"key":           project.Key,
		"name":          project.Name,
		"description":   project.Description,
		"repo_name":     project.RepoName,
		"repo_url":      project.RepoURL,
		"repo_base_url": project.RepoBaseURL,
		"created_at":    project.CreatedAt.Format(time.RFC3339),
	}
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal project meta: %w", err)
	}
	if err := os.WriteFile(filepath.Join(workdir, ".zeus", "project.json"), data, 0o644); err != nil {
		return fmt.Errorf("write project.json: %w", err)
	}

	return nil
}

func (s *Service) markProjectFailed(ctx context.Context, project *domain.Project) error {
	if project == nil || s.projectRepo == nil {
		return fmt.Errorf("project repository is required")
	}
	project.Status = domain.ProjectStatusFailed
	project.UpdatedAt = s.nowTime()
	return s.projectRepo.Update(ctx, project)
}

func writeJSONFile(path string, payload interface{}) error {
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal json: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write file: %w", err)
	}
	return nil
}

func buildRepoName(projectKey string) string {
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return ""
	}
	return fmt.Sprintf("%s.git", projectKey)
}

func (s *Service) buildRepoURL(baseURL, repoName string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	repoName = strings.TrimSpace(repoName)
	if baseURL == "" || repoName == "" {
		return ""
	}
	return baseURL + "/" + strings.TrimLeft(repoName, "/")
}

func (s *Service) nowTime() time.Time {
	return time.Now()
}

func (s *Service) buildRepoBaseURL() string {
	if config.AppConfig != nil {
		base := strings.TrimSpace(config.AppConfig.Git.RepoURLPrefix)
		if base != "" {
			return base
		}
		base = strings.TrimSpace(config.AppConfig.Git.BareRepoRoot)
		if base != "" {
			return base
		}
	}
	if s.gitAdmin != nil {
		// Best effort: RepoURL(repoName) uses base + repoName; caller can overwrite base later.
		return strings.TrimSpace(s.gitAdmin.RepoURL(""))
	}
	return ""
}

func (s *Service) repoRoot() string {
	if config.AppConfig != nil && strings.TrimSpace(config.AppConfig.Git.RepoRoot) != "" {
		return strings.TrimSpace(config.AppConfig.Git.RepoRoot)
	}
	return "/var/lib/zeus/repos"
}

func (s *Service) defaultBranch() string {
	if config.AppConfig != nil && strings.TrimSpace(config.AppConfig.Git.DefaultBranch) != "" {
		return strings.TrimSpace(config.AppConfig.Git.DefaultBranch)
	}
	return "main"
}

var _ service.ProjectService = (*Service)(nil)
