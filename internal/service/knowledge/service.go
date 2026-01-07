package knowledge

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"zeus/internal/domain"
	"zeus/internal/infra/gitclient"
	"zeus/internal/repository"
	"zeus/internal/service"
	"zeus/internal/util"
)

const defaultBranch = "main"

type Service struct {
	repo        repository.KnowledgeRepository
	projectRepo repository.ProjectRepository
	git         *gitclient.SessionGitClient
	now         func() time.Time
	branch      string
	authorName  string
	authorEmail string
}

func NewService(
	repo repository.KnowledgeRepository,
	projectRepo repository.ProjectRepository,
	git *gitclient.SessionGitClient,
	authorName string,
	authorEmail string,
	branch string,
) (*Service, error) {
	if repo == nil {
		return nil, fmt.Errorf("knowledge repository is required")
	}
	if projectRepo == nil {
		return nil, fmt.Errorf("project repository is required")
	}
	if git == nil {
		return nil, fmt.Errorf("session git client is required")
	}
	if strings.TrimSpace(authorName) == "" || strings.TrimSpace(authorEmail) == "" {
		return nil, fmt.Errorf("git author name and email are required")
	}
	if branch == "" {
		branch = defaultBranch
	}
	return &Service{
		repo:        repo,
		projectRepo: projectRepo,
		git:         git,
		now:         time.Now,
		branch:      branch,
		authorName:  strings.TrimSpace(authorName),
		authorEmail: strings.TrimSpace(authorEmail),
	}, nil
}

func (s *Service) ListDocuments(ctx context.Context, projectKey string) ([]domain.DocumentMeta, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("knowledge service not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return nil, fmt.Errorf("project key is required")
	}
	var metas []domain.DocumentMeta
	if err := s.withSessionRepo(ctx, projectKey, func(session *gitclient.GitSession) error {
		var err error
		metas, err = s.repo.ListDocuments(ctx, projectKey)
		return err
	}); err != nil {
		return nil, err
	}
	return metas, nil
}

func (s *Service) ListDocumentsByParent(
	ctx context.Context,
	projectKey string,
	parentID string,
) ([]service.KnowledgeDocumentListItem, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("knowledge service not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return nil, fmt.Errorf("project key is required")
	}

	var metas []domain.DocumentMeta
	if err := s.withSessionRepo(ctx, projectKey, func(session *gitclient.GitSession) error {
		var err error
		metas, err = s.repo.ListDocuments(ctx, projectKey)
		return err
	}); err != nil {
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
	if s == nil || s.repo == nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("knowledge service not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("project key is required")
	}
	docID = strings.TrimSpace(docID)
	if docID == "" {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("doc id is required")
	}
	var meta domain.DocumentMeta
	var content domain.DocumentContent
	if err := s.withSessionRepo(ctx, projectKey, func(session *gitclient.GitSession) error {
		var err error
		meta, content, err = s.repo.ReadDocument(ctx, projectKey, docID)
		return err
	}); err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}
	return meta, content, nil
}

func (s *Service) CreateDocument(
	ctx context.Context,
	projectKey string,
	req service.KnowledgeCreateRequest,
) (domain.DocumentMeta, domain.DocumentContent, error) {
	if s == nil || s.repo == nil || s.git == nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("knowledge service not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("project key is required")
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

	now := s.nowTime()
	if meta.CreatedAt.IsZero() {
		meta.CreatedAt = now
	}
	meta.UpdatedAt = now

	var createdMeta domain.DocumentMeta
	var createdContent domain.DocumentContent
	if err := s.withSessionRepo(ctx, projectKey, func(session *gitclient.GitSession) error {
		if err := s.resolveOpenAPISlug(ctx, projectKey, &meta); err != nil {
			return err
		}
		if meta.Path == "" {
			meta.Path = "/" + meta.Slug
		}

		var content domain.DocumentContent
		if req.OpenAPI != nil {
			if meta.DocType != string(domain.DocTypeOpenAPI) {
				return fmt.Errorf("doc_type must be openapi")
			}
			content = buildOpenAPIContent(*req.OpenAPI, now)
		} else {
			if req.Content == nil {
				return fmt.Errorf("content is required")
			}
			content = normalizeContent(*req.Content, nil, now)
		}

		if err := s.repo.CreateDocument(ctx, projectKey, meta, content); err != nil {
			return err
		}
		if err := session.AddAll(); err != nil {
			return err
		}
		if err := session.Commit(fmt.Sprintf("docs: create %s", meta.ID)); err != nil {
			return err
		}
		if err := session.Push("origin", s.branch); err != nil {
			return err
		}
		createdMeta = meta
		createdContent = content
		return nil
	}); err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}
	return createdMeta, createdContent, nil
}

func (s *Service) UpdateDocument(
	ctx context.Context,
	projectKey string,
	docID string,
	req service.KnowledgeUpdateRequest,
) (domain.DocumentMeta, domain.DocumentContent, error) {
	if s == nil || s.repo == nil || s.git == nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("knowledge service not initialized")
	}
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
	var updatedMeta domain.DocumentMeta
	var updatedContent domain.DocumentContent
	if err := s.withSessionRepo(ctx, projectKey, func(session *gitclient.GitSession) error {
		existingMeta, existingContent, err := s.repo.ReadDocument(ctx, projectKey, docID)
		if err != nil {
			return err
		}

		now := s.nowTime()
		metaPatch, err := buildMetaPatch(existingMeta, req.Meta, now)
		if err != nil {
			return err
		}

		var contentPatch *domain.DocumentContent
		if req.Content != nil {
			normalized := normalizeContent(*req.Content, existingContent.Meta, now)
			contentPatch = &normalized
		}

		if err := s.repo.UpdateDocument(ctx, projectKey, docID, metaPatch, contentPatch); err != nil {
			return err
		}
		if err := session.AddAll(); err != nil {
			return err
		}
		if err := session.Commit(fmt.Sprintf("docs: update %s", docID)); err != nil {
			return err
		}
		if err := session.Push("origin", s.branch); err != nil {
			return err
		}

		updatedMeta = existingMeta
		if metaPatch != nil {
			updatedMeta = applyMetaPatch(existingMeta, metaPatch)
		}
		updatedContent = existingContent
		if contentPatch != nil {
			updatedContent = *contentPatch
		}
		return nil
	}); err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}

	return updatedMeta, updatedContent, nil
}

func (s *Service) withSessionRepo(
	ctx context.Context,
	projectKey string,
	fn func(*gitclient.GitSession) error,
) error {
	if s.git == nil || s.projectRepo == nil {
		return fmt.Errorf("session git client and project repository are required")
	}
	if fn == nil {
		return fmt.Errorf("repo operation is required")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return fmt.Errorf("project key is required")
	}

	project, err := s.projectRepo.FindByKey(ctx, projectKey)
	if err != nil {
		return fmt.Errorf("find project: %w", err)
	}
	if project == nil {
		return fmt.Errorf("project not found")
	}
	repoURL := strings.TrimSpace(project.RepoURL)
	if repoURL == "" {
		return fmt.Errorf("project repo url is required")
	}

	s.git.SetRemote(repoURL)
	s.git.SetAuthor(s.authorName, s.authorEmail)
	return s.git.WithSessionRepo(ctx, func(session *gitclient.GitSession) error {
		if err := session.PullRebase("origin", s.branch); err != nil {
			return err
		}
		return fn(session)
	})
}

func (s *Service) nowTime() time.Time {
	if s.now == nil {
		return time.Now()
	}
	return s.now()
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
	projectKey string,
	meta *domain.DocumentMeta,
) error {
	if meta == nil || meta.DocType != string(domain.DocTypeOpenAPI) {
		return nil
	}
	metas, err := s.repo.ListDocuments(ctx, projectKey)
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
