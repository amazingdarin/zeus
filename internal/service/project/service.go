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

	"zeus/internal/domain"
	"zeus/internal/infra/gitadmin"
	"zeus/internal/infra/gitclient"
	"zeus/internal/repository"
	"zeus/internal/service"
)

type Service struct {
	projectRepo repository.ProjectRepository
	gitAdmin    gitadmin.GitAdmin
	gitClient   gitclient.GitClient
	branch      string
	authorName  string
	authorEmail string
	now         func() time.Time
}

func NewService(
	projectRepo repository.ProjectRepository,
	gitAdmin gitadmin.GitAdmin,
	gitClient gitclient.GitClient,
	authorName string,
	authorEmail string,
	branch string,
) *Service {
	if branch == "" {
		branch = "main"
	}
	return &Service{
		projectRepo: projectRepo,
		gitAdmin:    gitAdmin,
		gitClient:   gitClient,
		branch:      branch,
		authorName:  strings.TrimSpace(authorName),
		authorEmail: strings.TrimSpace(authorEmail),
		now:         time.Now,
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
	if project.RepoName == "" {
		project.RepoName = buildRepoName(project.Key)
	}
	if project.RepoURL == "" {
		project.RepoURL = s.buildRepoURL(project.RepoName)
	}

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

func (s *Service) initRepo(ctx context.Context, project *domain.Project) error {
	if project == nil {
		return fmt.Errorf("project is required")
	}
	if s.gitAdmin == nil {
		return fmt.Errorf("git admin is required")
	}
	if s.gitClient == nil {
		return fmt.Errorf("git client is required")
	}
	if s.authorName == "" || s.authorEmail == "" {
		return fmt.Errorf("git author name and email are required")
	}

	repoURL, err := s.gitAdmin.CreateBareRepo(ctx, project.RepoName)
	if err != nil {
		return fmt.Errorf("create bare repo: %w", err)
	}
	if repoURL != "" {
		project.RepoURL = repoURL
	}

	tempRoot, err := os.MkdirTemp("", fmt.Sprintf("zeus-%s-", project.Key))
	if err != nil {
		return fmt.Errorf("create temp repo: %w", err)
	}
	defer os.RemoveAll(tempRoot)
	workdir := filepath.Join(tempRoot, "repo")

	if err := s.gitClient.EnsureCloned(ctx, project.Key, project.RepoURL, workdir); err != nil {
		return fmt.Errorf("clone repo: %w", err)
	}
	if err := s.gitClient.CheckoutBranch(ctx, project.Key, workdir, s.branch); err != nil {
		return fmt.Errorf("checkout branch: %w", err)
	}

	if err := s.writeRepoScaffold(workdir, project); err != nil {
		return err
	}

	if _, err := s.gitClient.CommitAll(
		ctx,
		project.Key,
		workdir,
		fmt.Sprintf("docs: init %s", project.Key),
		s.authorName,
		s.authorEmail,
	); err != nil {
		return fmt.Errorf("commit init: %w", err)
	}
	if err := s.gitClient.Push(ctx, project.Key, workdir, s.branch); err != nil {
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
		"id":          project.ID,
		"key":         project.Key,
		"name":        project.Name,
		"description": project.Description,
		"repo_name":   project.RepoName,
		"repo_url":    project.RepoURL,
		"created_at":  project.CreatedAt.Format(time.RFC3339),
	}
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal project meta: %w", err)
	}
	if err := os.WriteFile(filepath.Join(workdir, ".zeus", "project.json"), data, 0o644); err != nil {
		return fmt.Errorf("write project.json: %w", err)
	}

	createdAt := project.CreatedAt
	if createdAt.IsZero() {
		createdAt = s.nowTime()
	}
	initDocs := []struct {
		slug    string
		title   string
		docType string
	}{
		{slug: "overview", title: "Overview", docType: "overview"},
		{slug: "project", title: "Project", docType: "document"},
	}
	for _, doc := range initDocs {
		if err := writeEmptyDocument(workdir, doc.slug, doc.title, doc.docType, createdAt); err != nil {
			return err
		}
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

func writeEmptyDocument(workdir, slug, title, docType string, now time.Time) error {
	slug = strings.TrimSpace(slug)
	title = strings.TrimSpace(title)
	if slug == "" || title == "" {
		return fmt.Errorf("document slug and title are required")
	}
	if docType == "" {
		docType = "document"
	}
	docDir := filepath.Join(workdir, "docs", slug)
	if err := os.MkdirAll(docDir, 0o755); err != nil {
		return fmt.Errorf("create document dir: %w", err)
	}

	meta := map[string]interface{}{
		"id":         uuid.NewString(),
		"slug":       slug,
		"title":      title,
		"parent":     "root",
		"path":       "/" + slug,
		"status":     "draft",
		"doc_type":   docType,
		"tags":       []string{},
		"created_at": now.Format(time.RFC3339),
		"updated_at": now.Format(time.RFC3339),
	}
	if err := writeJSONFile(filepath.Join(docDir, ".meta.json"), meta); err != nil {
		return fmt.Errorf("write meta: %w", err)
	}

	content := map[string]interface{}{
		"meta": map[string]interface{}{
			"zeus":           true,
			"format":         "tiptap",
			"schema_version": 1,
			"editor":         "tiptap",
			"created_at":     now.Format(time.RFC3339),
			"updated_at":     now.Format(time.RFC3339),
		},
		"content": map[string]interface{}{
			"type":    "doc",
			"content": []interface{}{},
		},
	}
	if err := writeJSONFile(filepath.Join(docDir, "content.json"), content); err != nil {
		return fmt.Errorf("write content: %w", err)
	}
	return nil
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
	return fmt.Sprintf("zeus-%s.git", projectKey)
}

func (s *Service) buildRepoURL(repoName string) string {
	repoName = strings.TrimSpace(repoName)
	if repoName == "" {
		return ""
	}
	if s.gitAdmin != nil {
		return s.gitAdmin.RepoURL(repoName)
	}
	return repoName
}

func (s *Service) nowTime() time.Time {
	if s.now == nil {
		return time.Now()
	}
	return s.now()
}

var _ service.ProjectService = (*Service)(nil)
