package git

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"zeus/internal/domain"
	projectrepo "zeus/internal/modules/project/repository"
	"zeus/internal/repository"
)

type GitDocumentReader struct {
	knowledgeRepo repository.KnowledgeRepository
	projectRepo   projectrepo.ProjectRepository
}

func NewGitDocumentReader(
	knowledgeRepo repository.KnowledgeRepository,
	projectRepo projectrepo.ProjectRepository,
) *GitDocumentReader {
	return &GitDocumentReader{
		knowledgeRepo: knowledgeRepo,
		projectRepo:   projectRepo,
	}
}

func (r *GitDocumentReader) ListDocuments(ctx context.Context, projectID string) ([]repository.DocumentRef, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, fmt.Errorf("project id is required")
	}
	project, err := r.projectRepo.FindByID(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("find project: %w", err)
	}
	if project == nil {
		return nil, fmt.Errorf("project not found")
	}
	metas, err := r.knowledgeRepo.ListDocuments(ctx, project.RepoName)
	if err != nil {
		return nil, err
	}
	refs := make([]repository.DocumentRef, 0, len(metas))
	for _, meta := range metas {
		if meta.ID == "" {
			continue
		}
		refs = append(refs, repository.DocumentRef{DocID: meta.ID})
	}
	return refs, nil
}

func (r *GitDocumentReader) ReadDocument(ctx context.Context, projectID, docID string) (repository.Document, error) {
	projectID = strings.TrimSpace(projectID)
	docID = strings.TrimSpace(docID)
	if projectID == "" {
		return repository.Document{}, fmt.Errorf("project id is required")
	}
	if docID == "" {
		return repository.Document{}, fmt.Errorf("doc id is required")
	}
	project, err := r.projectRepo.FindByID(ctx, projectID)
	if err != nil {
		return repository.Document{}, fmt.Errorf("find project: %w", err)
	}
	if project == nil {
		return repository.Document{}, fmt.Errorf("project not found")
	}
	meta, content, err := r.knowledgeRepo.ReadDocument(ctx, project.RepoName, docID)
	if err != nil {
		return repository.Document{}, err
	}
	metas, err := r.knowledgeRepo.ListDocuments(ctx, project.RepoName)
	if err != nil {
		return repository.Document{}, err
	}
	path := resolvePath(meta, buildMetaMap(metas))
	payload, err := json.Marshal(content)
	if err != nil {
		return repository.Document{}, fmt.Errorf("marshal content json: %w", err)
	}
	return repository.Document{ProjectID: projectID, DocID: docID, Path: path, ContentJSON: payload}, nil
}

func buildMetaMap(metas []domain.DocumentMeta) map[string]domain.DocumentMeta {
	metaByID := make(map[string]domain.DocumentMeta, len(metas))
	for _, meta := range metas {
		if meta.ID == "" {
			continue
		}
		metaByID[meta.ID] = meta
	}
	return metaByID
}

func resolvePath(meta domain.DocumentMeta, metaByID map[string]domain.DocumentMeta) []string {
	if meta.Path != "" {
		parts := splitPath(meta.Path)
		if len(parts) > 0 {
			return parts
		}
	}
	chain := make([]string, 0, 4)
	visited := make(map[string]struct{})
	current := meta
	for current.ID != "" {
		if _, seen := visited[current.ID]; seen {
			break
		}
		visited[current.ID] = struct{}{}
		title := strings.TrimSpace(current.Title)
		if title == "" {
			title = strings.TrimSpace(current.Slug)
		}
		if title == "" {
			title = current.ID
		}
		chain = append(chain, title)
		parentID := normalizeParentID(current.Parent)
		if parentID == "" {
			break
		}
		parent, ok := metaByID[parentID]
		if !ok {
			break
		}
		current = parent
	}
	for i, j := 0, len(chain)-1; i < j; i, j = i+1, j-1 {
		chain[i], chain[j] = chain[j], chain[i]
	}
	return chain
}

func splitPath(path string) []string {
	trimmed := strings.TrimSpace(path)
	trimmed = strings.Trim(trimmed, "/")
	if trimmed == "" {
		return nil
	}
	parts := strings.Split(trimmed, "/")
	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		filtered = append(filtered, part)
	}
	return filtered
}

func normalizeParentID(parent string) string {
	parent = strings.TrimSpace(parent)
	if parent == "" || parent == "root" {
		return ""
	}
	return parent
}
