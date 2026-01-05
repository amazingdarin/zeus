package git

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
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
	docDirs, err := r.listDocDirs(docsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []domain.DocumentMeta{}, nil
		}
		return nil, fmt.Errorf("read docs directory: %w", err)
	}

	metas := make([]domain.DocumentMeta, 0, len(docDirs))
	for _, docDir := range docDirs {
		meta, err := r.readMetaFile(docDir)
		if err != nil {
			return nil, err
		}
		slug := filepath.Base(docDir)
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

	content, err := r.readContentFile(slug)
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

	docsRoot := filepath.Join(localPath, "docs")
	baseDir, err := r.resolveParentDir(localPath, meta.Parent)
	if err != nil {
		return err
	}
	if baseDir == "" {
		baseDir = docsRoot
	}

	docDir := filepath.Join(baseDir, meta.Slug)
	if exists(docDir) {
		info, err := os.Stat(docDir)
		if err != nil {
			return fmt.Errorf("stat document directory: %w", err)
		}
		if !info.IsDir() {
			return fmt.Errorf("document path is not a directory: %s", meta.Slug)
		}
		metaPath := filepath.Join(docDir, ".meta.json")
		contentPath := filepath.Join(docDir, "content.json")
		if exists(metaPath) || exists(contentPath) {
			return fmt.Errorf("document already exists: %s", meta.Slug)
		}
	} else if err := os.MkdirAll(docDir, 0o755); err != nil {
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
		if err := writeJSON(filepath.Join(slug, ".meta.json"), meta); err != nil {
			return fmt.Errorf("write meta: %w", err)
		}
	}

	if contentPatch != nil {
		if err := writeJSON(filepath.Join(slug, "content.json"), contentPatch); err != nil {
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
	if err := r.gitClient.EnsureCloned(ctx, projectKey, project.RepoURL, localPath); err != nil {
		return "", fmt.Errorf("ensure repo: %w", err)
	}
	if err := r.gitClient.PullRebase(ctx, projectKey, localPath, r.branch); err != nil {
		return "", fmt.Errorf("pull rebase: %w", err)
	}
	return localPath, nil
}

func (r *KnowledgeRepository) readMetaFile(docDir string) (domain.DocumentMeta, error) {
	metaPath := filepath.Join(docDir, ".meta.json")
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

func (r *KnowledgeRepository) readContentFile(docDir string) (domain.DocumentContent, error) {
	contentPath := filepath.Join(docDir, "content.json")
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
	docDirs, err := r.listDocDirs(docsDir)
	if err != nil {
		return domain.DocumentMeta{}, "", fmt.Errorf("read docs directory: %w", err)
	}

	for _, docDir := range docDirs {
		meta, err := r.readMetaFile(docDir)
		if err != nil {
			return domain.DocumentMeta{}, "", err
		}
		if meta.ID == docID {
			slug := filepath.Base(docDir)
			if meta.Slug == "" {
				meta.Slug = slug
			}
			if meta.Slug != slug {
				return domain.DocumentMeta{}, "", fmt.Errorf("meta slug mismatch: %s", slug)
			}
			return meta, docDir, nil
		}
	}

	return domain.DocumentMeta{}, "", repository.ErrDocumentNotFound
}

func (r *KnowledgeRepository) listDocDirs(docsDir string) ([]string, error) {
	if docsDir == "" {
		return nil, fmt.Errorf("docs directory is required")
	}
	dirs := make([]string, 0)
	err := filepath.WalkDir(docsDir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			return nil
		}
		if path == docsDir {
			return nil
		}
		if exists(filepath.Join(path, ".meta.json")) {
			dirs = append(dirs, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return dirs, nil
}

func (r *KnowledgeRepository) resolveParentDir(localPath, parentID string) (string, error) {
	parentID = strings.TrimSpace(parentID)
	if parentID == "" || parentID == "root" {
		return filepath.Join(localPath, "docs"), nil
	}
	_, docDir, err := r.findMetaByID(localPath, parentID)
	if err != nil {
		return "", fmt.Errorf("find parent document: %w", err)
	}
	return docDir, nil
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
