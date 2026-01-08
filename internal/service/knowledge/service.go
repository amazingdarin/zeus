package knowledge

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"zeus/internal/domain"
	"zeus/internal/repository"
	"zeus/internal/service"
	"zeus/internal/util"
)

type Service struct {
	knowledgeRepo repository.KnowledgeRepository
	projectRepo   repository.ProjectRepository
}

func NewService(
	knowledgeRepo repository.KnowledgeRepository,
	projectRepo repository.ProjectRepository,
) *Service {
	return &Service{
		knowledgeRepo: knowledgeRepo,
		projectRepo:   projectRepo,
	}
}

func (s *Service) ListDocuments(ctx context.Context, projectKey string) ([]domain.DocumentMeta, error) {
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return nil, fmt.Errorf("project key is required")
	}

	project, err := s.projectRepo.FindByKey(ctx, projectKey)
	if err != nil {
		return nil, fmt.Errorf("find project: %w", err)
	}

	metas, err := s.knowledgeRepo.ListDocuments(ctx, project.RepoName)
	if err != nil {
		return nil, err
	}
	return metas, nil
}

func (s *Service) ListDocumentsByParent(
	ctx context.Context,
	projectKey string,
	parentID string,
) ([]service.KnowledgeDocumentListItem, error) {
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return nil, fmt.Errorf("project key is required")
	}

	project, err := s.projectRepo.FindByKey(ctx, projectKey)
	if err != nil {
		return nil, fmt.Errorf("find project: %w", err)
	}

	metas, err := s.knowledgeRepo.ListDocuments(ctx, project.RepoName)
	if err != nil {
		return nil, err
	}

	childMap := buildChildMap(metas)
	filtered := filterByParent(metas, parentID)
	items := make([]service.KnowledgeDocumentListItem, 0, len(filtered))
	for _, meta := range filtered {
		items = append(items, service.KnowledgeDocumentListItem{
			Meta:     meta,
			HasChild: childMap[meta.ID],
		})
	}
	return items, nil
}

func (s *Service) GetDocument(
	ctx context.Context,
	projectKey string,
	docID string,
) (domain.DocumentMeta, domain.DocumentContent, error) {
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("project key is required")
	}
	docID = strings.TrimSpace(docID)
	if docID == "" {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("doc id is required")
	}

	project, err := s.projectRepo.FindByKey(ctx, projectKey)
	if err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("find project: %w", err)
	}

	meta, content, err := s.knowledgeRepo.ReadDocument(ctx, project.RepoName, docID)
	if err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}
	return meta, content, nil
}

func (s *Service) CreateDocument(
	ctx context.Context,
	projectKey string,
	req service.KnowledgeCreateRequest,
) (domain.DocumentMeta, domain.DocumentContent, error) {
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("project key is required")
	}

	project, err := s.projectRepo.FindByKey(ctx, projectKey)
	if err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("find project: %w", err)
	}

	meta := req.Meta
	meta.ID = strings.TrimSpace(meta.ID)
	meta.Slug = strings.TrimSpace(meta.Slug)
	meta.Title = strings.TrimSpace(meta.Title)
	meta.DocType = strings.TrimSpace(meta.DocType)
	if req.OpenAPI != nil && meta.DocType == "" {
		meta.DocType = string(domain.DocTypeOpenAPI)
	}
	if meta.Title == "" {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("doc title is required")
	}
	if meta.ID == "" {
		meta.ID = uuid.NewString()
	}
	if meta.Slug == "" {
		if meta.DocType == string(domain.DocTypeOpenAPI) {
			meta.Slug = util.SlugifyFilename(meta.Title)
		} else {
			meta.Slug = slugify(meta.Title)
		}
		if meta.Slug == "" {
			meta.Slug = meta.ID
		}
	}
	if meta.DocType == "" {
		meta.DocType = string(domain.DocTypeDocument)
	}

	now := time.Now()
	if meta.CreatedAt.IsZero() {
		meta.CreatedAt = now
	}
	meta.UpdatedAt = now

	if err := s.resolveOpenAPISlug(ctx, project.RepoName, &meta); err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}
	if meta.Path == "" {
		meta.Path = "/" + meta.Slug
	}

	var content domain.DocumentContent
	if req.OpenAPI != nil {
		if meta.DocType != string(domain.DocTypeOpenAPI) {
			return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("doc_type must be openapi")
		}
		content = buildOpenAPIContent(*req.OpenAPI, now)
	} else {
		if req.Content == nil {
			return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("content is required")
		}
		content = normalizeContent(*req.Content, nil, now)
	}

	if err := s.knowledgeRepo.CreateDocument(ctx, project.RepoName, meta, content); err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}
	return meta, content, nil
}

func (s *Service) UpdateDocument(
	ctx context.Context,
	projectKey string,
	docID string,
	req service.KnowledgeUpdateRequest,
) (domain.DocumentMeta, domain.DocumentContent, error) {
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("project key is required")
	}
	docID = strings.TrimSpace(docID)
	if docID == "" {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("doc id is required")
	}
	if req.Meta == nil && req.Content == nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("no updates provided")
	}

	project, err := s.projectRepo.FindByKey(ctx, projectKey)
	if err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("find project: %w", err)
	}

	existingMeta, existingContent, err := s.knowledgeRepo.ReadDocument(ctx, project.RepoName, docID)
	if err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}

	now := time.Now()
	metaPatch, err := buildMetaPatch(existingMeta, req.Meta, now)
	if err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}

	var contentPatch *domain.DocumentContent
	if req.Content != nil {
		normalized := normalizeContent(*req.Content, existingContent.Meta, now)
		contentPatch = &normalized
	}

	if err := s.knowledgeRepo.UpdateDocument(ctx, project.RepoName, docID, metaPatch, contentPatch); err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}

	updatedMeta := existingMeta
	if metaPatch != nil {
		updatedMeta = applyMetaPatch(existingMeta, metaPatch)
	}
	updatedContent := existingContent
	if contentPatch != nil {
		updatedContent = *contentPatch
	}
	return updatedMeta, updatedContent, nil
}

func buildMetaPatch(
	existing domain.DocumentMeta,
	req *domain.DocumentMeta,
	now time.Time,
) (*domain.DocumentMeta, error) {
	patch := &domain.DocumentMeta{
		UpdatedAt: now,
	}
	if req == nil {
		return patch, nil
	}

	if req.ID != "" && req.ID != existing.ID {
		return nil, fmt.Errorf("doc id mismatch")
	}
	if req.Slug != "" && req.Slug != existing.Slug {
		return nil, fmt.Errorf("doc slug mismatch")
	}
	if title := strings.TrimSpace(req.Title); title != "" {
		patch.Title = title
	}
	if parent := strings.TrimSpace(req.Parent); parent != "" {
		patch.Parent = parent
	}
	if path := strings.TrimSpace(req.Path); path != "" {
		patch.Path = path
	}
	if status := strings.TrimSpace(req.Status); status != "" {
		patch.Status = status
	}
	if docType := strings.TrimSpace(req.DocType); docType != "" {
		patch.DocType = docType
	}
	if req.Tags != nil {
		patch.Tags = req.Tags
	}
	return patch, nil
}

func applyMetaPatch(current domain.DocumentMeta, patch *domain.DocumentMeta) domain.DocumentMeta {
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
	if patch.DocType != "" {
		current.DocType = patch.DocType
	}
	if patch.Tags != nil {
		current.Tags = patch.Tags
	}
	if !patch.UpdatedAt.IsZero() {
		current.UpdatedAt = patch.UpdatedAt
	}
	return current
}

func normalizeContent(
	content domain.DocumentContent,
	existingMeta map[string]interface{},
	now time.Time,
) domain.DocumentContent {
	meta := mergeMetaMaps(existingMeta, content.Meta)
	createdAt := firstMetaString(existingMeta, "created_at")
	if createdAt == "" {
		createdAt = firstMetaString(content.Meta, "created_at")
	}
	if createdAt == "" {
		createdAt = now.Format(time.RFC3339)
	}
	meta["created_at"] = createdAt
	meta["updated_at"] = now.Format(time.RFC3339)
	return domain.DocumentContent{
		Meta:    meta,
		Content: content.Content,
	}
}

func mergeMetaMaps(base, incoming map[string]interface{}) map[string]interface{} {
	merged := make(map[string]interface{})
	for key, value := range base {
		merged[key] = value
	}
	for key, value := range incoming {
		merged[key] = value
	}
	return merged
}

func firstMetaString(meta map[string]interface{}, key string) string {
	if meta == nil {
		return ""
	}
	value, ok := meta[key]
	if !ok {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func slugify(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return ""
	}
	var out strings.Builder
	out.Grow(len(value))
	prevDash := false
	for _, r := range value {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			out.WriteRune(r)
			prevDash = false
			continue
		}
		if r == '-' || r == '_' || r == ' ' {
			if prevDash || out.Len() == 0 {
				continue
			}
			out.WriteByte('-')
			prevDash = true
		}
	}
	result := strings.Trim(out.String(), "-")
	return result
}

func (s *Service) resolveOpenAPISlug(
	ctx context.Context,
	repo string,
	meta *domain.DocumentMeta,
) error {
	if meta == nil || meta.DocType != string(domain.DocTypeOpenAPI) {
		return nil
	}
	metas, err := s.knowledgeRepo.ListDocuments(ctx, repo)
	if err != nil {
		return err
	}
	parent := strings.TrimSpace(meta.Parent)
	rootQuery := parent == "" || strings.EqualFold(parent, "root")
	exists := func(slug string) bool {
		for _, item := range metas {
			if strings.TrimSpace(item.Slug) != slug {
				continue
			}
			itemParent := strings.TrimSpace(item.Parent)
			if rootQuery {
				if itemParent == "" || strings.EqualFold(itemParent, "root") {
					return true
				}
				continue
			}
			if itemParent == parent {
				return true
			}
		}
		return false
	}
	meta.Slug = util.ResolveSlugConflict(meta.Slug, exists)
	return nil
}

func buildOpenAPIContent(openapi service.KnowledgeOpenAPI, now time.Time) domain.DocumentContent {
	renderer := strings.TrimSpace(openapi.Renderer)
	if renderer == "" {
		renderer = "swagger"
	}
	return domain.DocumentContent{
		Meta: map[string]interface{}{
			"zeus":           true,
			"format":         "tiptap",
			"schema_version": 1,
			"editor":         "tiptap",
			"created_at":     now.Format(time.RFC3339),
			"updated_at":     now.Format(time.RFC3339),
		},
		Content: map[string]interface{}{
			"type": "doc",
			"content": []interface{}{
				map[string]interface{}{
					"type": "openapi",
					"attrs": map[string]interface{}{
						"source":   openapi.Source,
						"renderer": renderer,
					},
				},
			},
		},
	}
}

func filterByParent(metas []domain.DocumentMeta, parentID string) []domain.DocumentMeta {
	parentID = strings.TrimSpace(parentID)
	rootQuery := parentID == "" || strings.EqualFold(parentID, "root")
	filtered := make([]domain.DocumentMeta, 0, len(metas))
	for _, meta := range metas {
		parent := strings.TrimSpace(meta.Parent)
		if rootQuery {
			if parent == "" || strings.EqualFold(parent, "root") {
				filtered = append(filtered, meta)
			}
			continue
		}
		if parent == parentID {
			filtered = append(filtered, meta)
		}
	}
	return filtered
}

func buildChildMap(metas []domain.DocumentMeta) map[string]bool {
	childMap := make(map[string]bool, len(metas))
	for _, meta := range metas {
		parent := strings.TrimSpace(meta.Parent)
		if parent == "" || strings.EqualFold(parent, "root") {
			continue
		}
		childMap[parent] = true
	}
	return childMap
}
