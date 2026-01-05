package git

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"zeus/internal/domain"
	"zeus/internal/infra/gitclient"
	"zeus/internal/repository"
)

const defaultBranch = "main"

type KnowledgeRepository struct {
	gitClient   gitclient.GitClient
	projectRepo repository.ProjectRepository
	branch      string
}

func NewKnowledgeRepository(
	gitClient gitclient.GitClient,
	projectRepo repository.ProjectRepository,
	branch string,
) *KnowledgeRepository {
	if branch == "" {
		branch = defaultBranch
	}
	return &KnowledgeRepository{
		gitClient:   gitClient,
		projectRepo: projectRepo,
		branch:      branch,
	}
}

func (r *KnowledgeRepository) ListDocuments(
	ctx context.Context,
	projectKey string,
) ([]domain.DocumentMeta, error) {
	localPath, err := r.ensureRepoReady(ctx, projectKey)
	if err != nil {
		return nil, err
	}

	docsDir := filepath.Join(localPath, "docs")
	entries, err := os.ReadDir(docsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []domain.DocumentMeta{}, nil
		}
		return nil, fmt.Errorf("read docs directory: %w", err)
	}

	metas := make([]domain.DocumentMeta, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		slug := entry.Name()
		meta, err := r.readMetaFile(docsDir, slug)
		if err != nil {
			return nil, err
		}
		if meta.Slug == "" {
			meta.Slug = slug
		}
		if meta.Slug != slug {
			return nil, fmt.Errorf("meta slug mismatch: %s", slug)
		}
		metas = append(metas, meta)
	}

	return metas, nil
}

func (r *KnowledgeRepository) ReadDocument(
	ctx context.Context,
	projectKey, docID string,
) (domain.DocumentMeta, domain.DocumentContent, error) {
	localPath, err := r.ensureRepoReady(ctx, projectKey)
	if err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}
	docID = strings.TrimSpace(docID)
	if docID == "" {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("doc id is required")
	}

	meta, slug, err := r.findMetaByID(localPath, docID)
	if err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}

	content, err := r.readContentFile(localPath, slug)
	if err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}

	return meta, content, nil
}

func (r *KnowledgeRepository) CreateDocument(
	ctx context.Context,
	projectKey string,
	meta domain.DocumentMeta,
	content domain.DocumentContent,
) error {
	localPath, err := r.ensureRepoReady(ctx, projectKey)
	if err != nil {
		return err
	}

	meta.ID = strings.TrimSpace(meta.ID)
	meta.Slug = strings.TrimSpace(meta.Slug)
	if meta.ID == "" {
		return fmt.Errorf("doc id is required")
	}
	if meta.Slug == "" {
		return fmt.Errorf("doc slug is required")
	}

	docDir := filepath.Join(localPath, "docs", meta.Slug)
	if exists(docDir) {
		return fmt.Errorf("document already exists: %s", meta.Slug)
	}
	if err := os.MkdirAll(docDir, 0o755); err != nil {
		return fmt.Errorf("create document directory: %w", err)
	}

	if err := writeJSON(filepath.Join(docDir, ".meta.json"), meta); err != nil {
		return fmt.Errorf("write meta: %w", err)
	}
	if err := writeJSON(filepath.Join(docDir, "content.json"), content); err != nil {
		return fmt.Errorf("write content: %w", err)
	}
	return nil
}

func (r *KnowledgeRepository) UpdateDocument(
	ctx context.Context,
	projectKey, docID string,
	metaPatch *domain.DocumentMeta,
	contentPatch *domain.DocumentContent,
) error {
	localPath, err := r.ensureRepoReady(ctx, projectKey)
	if err != nil {
		return err
	}
	docID = strings.TrimSpace(docID)
	if docID == "" {
		return fmt.Errorf("doc id is required")
	}
	if metaPatch == nil && contentPatch == nil {
		return fmt.Errorf("no updates provided")
	}

	meta, slug, err := r.findMetaByID(localPath, docID)
	if err != nil {
		return err
	}

	if metaPatch != nil {
		if metaPatch.ID != "" && metaPatch.ID != meta.ID {
			return fmt.Errorf("doc id mismatch")
		}
		if metaPatch.Slug != "" && metaPatch.Slug != meta.Slug {
			return fmt.Errorf("doc slug mismatch")
		}
		meta = mergeMeta(meta, metaPatch)
		if err := writeJSON(filepath.Join(localPath, "docs", slug, ".meta.json"), meta); err != nil {
			return fmt.Errorf("write meta: %w", err)
		}
	}

	if contentPatch != nil {
		if err := writeJSON(filepath.Join(localPath, "docs", slug, "content.json"), contentPatch); err != nil {
			return fmt.Errorf("write content: %w", err)
		}
	}
	return nil
}

func (r *KnowledgeRepository) ensureRepoReady(ctx context.Context, projectKey string) (string, error) {
	if r.gitClient == nil {
		return "", fmt.Errorf("git client is required")
	}
	if r.projectRepo == nil {
		return "", fmt.Errorf("project repository is required")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return "", fmt.Errorf("project key is required")
	}

	project, err := r.projectRepo.FindByKey(ctx, projectKey)
	if err != nil {
		return "", fmt.Errorf("find project: %w", err)
	}
	if project == nil {
		return "", fmt.Errorf("project not found")
	}
	if strings.TrimSpace(project.RepoURL) == "" {
		return "", fmt.Errorf("project repo url is required")
	}

	localPath := gitclient.RepoPath(projectKey)
	if localPath == "" {
		return "", fmt.Errorf("local path is required")
	}
	if err := r.gitClient.EnsureCloned(ctx, project.RepoURL, localPath); err != nil {
		return "", fmt.Errorf("ensure repo: %w", err)
	}
	if err := r.gitClient.PullRebase(ctx, localPath, r.branch); err != nil {
		return "", fmt.Errorf("pull rebase: %w", err)
	}
	return localPath, nil
}

func (r *KnowledgeRepository) readMetaFile(docsDir, slug string) (domain.DocumentMeta, error) {
	metaPath := filepath.Join(docsDir, slug, ".meta.json")
	data, err := os.ReadFile(metaPath)
	if err != nil {
		return domain.DocumentMeta{}, fmt.Errorf("read meta: %w", err)
	}
	var meta domain.DocumentMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return domain.DocumentMeta{}, fmt.Errorf("parse meta: %w", err)
	}
	if meta.ID == "" {
		return domain.DocumentMeta{}, fmt.Errorf("meta id is required")
	}
	return meta, nil
}

func (r *KnowledgeRepository) readContentFile(localPath, slug string) (domain.DocumentContent, error) {
	contentPath := filepath.Join(localPath, "docs", slug, "content.json")
	data, err := os.ReadFile(contentPath)
	if err != nil {
		return domain.DocumentContent{}, fmt.Errorf("read content: %w", err)
	}
	var content domain.DocumentContent
	if err := json.Unmarshal(data, &content); err != nil {
		return domain.DocumentContent{}, fmt.Errorf("parse content: %w", err)
	}
	return content, nil
}

func (r *KnowledgeRepository) findMetaByID(
	localPath, docID string,
) (domain.DocumentMeta, string, error) {
	docsDir := filepath.Join(localPath, "docs")
	entries, err := os.ReadDir(docsDir)
	if err != nil {
		return domain.DocumentMeta{}, "", fmt.Errorf("read docs directory: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		slug := entry.Name()
		meta, err := r.readMetaFile(docsDir, slug)
		if err != nil {
			return domain.DocumentMeta{}, "", err
		}
		if meta.ID == docID {
			if meta.Slug == "" {
				meta.Slug = slug
			}
			if meta.Slug != slug {
				return domain.DocumentMeta{}, "", fmt.Errorf("meta slug mismatch: %s", slug)
			}
			return meta, slug, nil
		}
	}

	return domain.DocumentMeta{}, "", repository.ErrDocumentNotFound
}

func mergeMeta(current domain.DocumentMeta, patch *domain.DocumentMeta) domain.DocumentMeta {
	if patch == nil {
		return current
	}
	if patch.Title != "" {
		current.Title = patch.Title
	}
	if patch.Parent != "" {
		current.Parent = patch.Parent
	}
	if patch.Path != "" {
		current.Path = patch.Path
	}
	if patch.Status != "" {
		current.Status = patch.Status
	}
	if patch.Tags != nil {
		current.Tags = patch.Tags
	}
	if !patch.CreatedAt.IsZero() {
		current.CreatedAt = patch.CreatedAt
	}
	if !patch.UpdatedAt.IsZero() {
		current.UpdatedAt = patch.UpdatedAt
	}
	return current
}

func writeJSON(path string, payload interface{}) error {
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal json: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write file: %w", err)
	}
	return nil
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
