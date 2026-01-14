package knowledge

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"zeus/internal/domain"
	"zeus/internal/repository"
	"zeus/internal/service"
	"zeus/internal/types"
	"zeus/internal/util"
)

type Service struct {
	knowledgeRepo repository.KnowledgeRepository
	projectRepo   repository.ProjectRepository
	proposalRepo  repository.KnowledgeChangeProposalRepository
}

func NewService(
	knowledgeRepo repository.KnowledgeRepository,
	projectRepo repository.ProjectRepository,
	proposalRepo repository.KnowledgeChangeProposalRepository,
) *Service {
	return &Service{
		knowledgeRepo: knowledgeRepo,
		projectRepo:   projectRepo,
		proposalRepo:  proposalRepo,
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
	order, err := s.normalizeIndex(ctx, project.RepoName, parentID, filtered)
	if err != nil {
		return nil, err
	}
	filtered = sortDocumentsByOrder(filtered, order)
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

func (s *Service) GetDocumentHierarchy(
	ctx context.Context,
	projectKey string,
	docID string,
) ([]service.KnowledgeDocumentHierarchyItem, error) {
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return nil, fmt.Errorf("project key is required")
	}
	docID = strings.TrimSpace(docID)
	if docID == "" {
		return nil, fmt.Errorf("doc id is required")
	}

	project, err := s.projectRepo.FindByKey(ctx, projectKey)
	if err != nil {
		return nil, fmt.Errorf("find project: %w", err)
	}

	metas, err := s.knowledgeRepo.ListDocuments(ctx, project.RepoName)
	if err != nil {
		return nil, err
	}

	metaByID := make(map[string]domain.DocumentMeta, len(metas))
	for _, meta := range metas {
		if meta.ID == "" {
			continue
		}
		metaByID[meta.ID] = meta
	}

	chain := make([]service.KnowledgeDocumentHierarchyItem, 0, 4)
	visited := make(map[string]struct{})
	currentID := docID
	for currentID != "" {
		if _, seen := visited[currentID]; seen {
			break
		}
		visited[currentID] = struct{}{}
		meta, ok := metaByID[currentID]
		if !ok {
			return nil, repository.ErrDocumentNotFound
		}
		chain = append(chain, service.KnowledgeDocumentHierarchyItem{
			ID:   meta.ID,
			Name: meta.Title,
		})
		parentID := normalizeParentID(meta.Parent)
		if parentID == "" {
			break
		}
		currentID = parentID
	}

	reverseHierarchy(chain)
	return chain, nil
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

	ctxNoPull := withSkipRepoPull(ctx)
	if err := s.knowledgeRepo.Commit(
		ctxNoPull,
		project.RepoName,
		fmt.Sprintf("docs: update %s", docID),
	); err != nil {
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

func (s *Service) MoveDocument(
	ctx context.Context,
	projectKey, docID string,
	req service.KnowledgeMoveRequest,
) (domain.DocumentMeta, error) {
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return domain.DocumentMeta{}, fmt.Errorf("project key is required")
	}
	docID = strings.TrimSpace(docID)
	if docID == "" {
		return domain.DocumentMeta{}, fmt.Errorf("doc id is required")
	}

	project, err := s.projectRepo.FindByKey(ctx, projectKey)
	if err != nil {
		return domain.DocumentMeta{}, fmt.Errorf("find project: %w", err)
	}

	metas, err := s.knowledgeRepo.ListDocuments(ctx, project.RepoName)
	if err != nil {
		return domain.DocumentMeta{}, err
	}

	current, ok := findMetaByID(metas, docID)
	if !ok {
		return domain.DocumentMeta{}, repository.ErrDocumentNotFound
	}

	targetParent := strings.TrimSpace(req.NewParentID)
	if targetParent == "" {
		targetParent = strings.TrimSpace(current.Parent)
	}
	targetParentNorm := normalizeParentID(targetParent)
	currentParentNorm := normalizeParentID(current.Parent)

	currentSiblings := filterByParent(metas, currentParentNorm)
	targetSiblings := currentSiblings
	if targetParentNorm != currentParentNorm {
		targetSiblings = filterByParent(metas, targetParentNorm)
	}

	oldOrder, err := s.normalizeIndex(ctx, project.RepoName, currentParentNorm, currentSiblings)
	if err != nil {
		return domain.DocumentMeta{}, err
	}
	sameParent := targetParentNorm == currentParentNorm
	newOrder := oldOrder
	if !sameParent {
		newOrder, err = s.normalizeIndex(ctx, project.RepoName, targetParentNorm, targetSiblings)
		if err != nil {
			return domain.DocumentMeta{}, err
		}
	}

	if sameParent {
		updatedOrder, err := insertIntoOrder(
			removeFromOrder(oldOrder.Order, docID),
			docID,
			req.BeforeID,
			req.AfterID,
		)
		if err != nil {
			return domain.DocumentMeta{}, err
		}
		newOrder.Order = updatedOrder
	} else {
		oldOrder.Order = removeFromOrder(oldOrder.Order, docID)
		updatedOrder, err := insertIntoOrder(newOrder.Order, docID, req.BeforeID, req.AfterID)
		if err != nil {
			return domain.DocumentMeta{}, err
		}
		newOrder.Order = updatedOrder
	}

	ctxNoPull := withSkipRepoPull(ctx)
	if !sameParent {
		if err := s.knowledgeRepo.WriteOrder(ctxNoPull, project.RepoName, currentParentNorm, oldOrder); err != nil {
			return domain.DocumentMeta{}, err
		}
	}
	if err := s.knowledgeRepo.WriteOrder(ctxNoPull, project.RepoName, targetParentNorm, newOrder); err != nil {
		return domain.DocumentMeta{}, err
	}

	now := time.Now()
	if !sameParent {
		parentValue := targetParentNorm
		if parentValue == "" {
			parentValue = "root"
		}
		patch := &domain.DocumentMeta{
			Parent:    parentValue,
			UpdatedAt: now,
		}
		if err := s.knowledgeRepo.UpdateDocument(ctxNoPull, project.RepoName, docID, patch, nil); err != nil {
			return domain.DocumentMeta{}, err
		}
		if err := s.knowledgeRepo.MoveDocumentDir(ctxNoPull, project.RepoName, docID, targetParentNorm); err != nil {
			return domain.DocumentMeta{}, err
		}
	}

	commitMsg := fmt.Sprintf(
		"move document %s from %s to %s",
		docID,
		formatParentForCommit(currentParentNorm),
		formatParentForCommit(targetParentNorm),
	)
	if sameParent {
		commitMsg = fmt.Sprintf("reorder documents under parent %s", formatParentForCommit(targetParentNorm))
	}
	if err := s.knowledgeRepo.Commit(ctxNoPull, project.RepoName, commitMsg); err != nil {
		return domain.DocumentMeta{}, err
	}

	updated := current
	updated.UpdatedAt = now
	if targetParentNorm != currentParentNorm {
		updated.Parent = targetParentNorm
	}
	return updated, nil
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

func normalizeParentID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || strings.EqualFold(value, "root") {
		return ""
	}
	return value
}

func reverseHierarchy(items []service.KnowledgeDocumentHierarchyItem) {
	for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
		items[i], items[j] = items[j], items[i]
	}
}

func findMetaByID(metas []domain.DocumentMeta, docID string) (domain.DocumentMeta, bool) {
	docID = strings.TrimSpace(docID)
	for _, meta := range metas {
		if meta.ID == docID {
			return meta, true
		}
	}
	return domain.DocumentMeta{}, false
}

// loadChildrenOrder ensures index.json exists so ordering is centralized per parent.
func (s *Service) loadChildrenOrder(
	ctx context.Context,
	repo string,
	parentID string,
	siblings []domain.DocumentMeta,
) (domain.DocumentOrder, error) {
	order, exists, err := s.knowledgeRepo.ReadOrder(ctx, repo, parentID)
	if err != nil {
		return domain.DocumentOrder{}, err
	}
	if exists {
		if order.Version == 0 {
			order.Version = 1
		}
		return order, nil
	}

	sortSiblingsStable(siblings)
	ids := make([]string, 0, len(siblings))
	for _, meta := range siblings {
		if strings.TrimSpace(meta.ID) == "" {
			continue
		}
		ids = append(ids, meta.ID)
	}
	order = domain.DocumentOrder{
		Version: 1,
		Order:   ids,
	}

	ctxNoPull := withSkipRepoPull(ctx)
	if err := s.knowledgeRepo.WriteOrder(ctxNoPull, repo, parentID, order); err != nil {
		return domain.DocumentOrder{}, err
	}
	if err := s.knowledgeRepo.Commit(
		ctxNoPull,
		repo,
		fmt.Sprintf("initialize index under parent %s", formatParentForCommit(parentID)),
	); err != nil {
		return domain.DocumentOrder{}, err
	}
	return order, nil
}

// normalizeIndex lazily appends missing children to index.json to keep ordering stable
// without touching every meta.json, minimizing Git conflict surface.
func (s *Service) normalizeIndex(
	ctx context.Context,
	repo string,
	parentID string,
	siblings []domain.DocumentMeta,
) (domain.DocumentOrder, error) {
	order, err := s.loadChildrenOrder(ctx, repo, parentID, siblings)
	if err != nil {
		return domain.DocumentOrder{}, err
	}
	if len(siblings) == 0 {
		return order, nil
	}

	seen := make(map[string]struct{}, len(order.Order))
	for _, id := range order.Order {
		if id = strings.TrimSpace(id); id != "" {
			seen[id] = struct{}{}
		}
	}

	missing := make([]domain.DocumentMeta, 0)
	for _, meta := range siblings {
		if meta.ID == "" {
			continue
		}
		if _, ok := seen[meta.ID]; ok {
			continue
		}
		missing = append(missing, meta)
	}
	if len(missing) == 0 {
		return order, nil
	}

	sortSiblingsStable(missing)
	for _, meta := range missing {
		order.Order = append(order.Order, meta.ID)
	}

	ctxNoPull := withSkipRepoPull(ctx)
	if err := s.knowledgeRepo.WriteOrder(ctxNoPull, repo, parentID, order); err != nil {
		return domain.DocumentOrder{}, err
	}
	if err := s.knowledgeRepo.Commit(
		ctxNoPull,
		repo,
		fmt.Sprintf("normalize index under parent %s", formatParentForCommit(parentID)),
	); err != nil {
		return domain.DocumentOrder{}, err
	}
	return order, nil
}

func sortDocumentsByOrder(
	siblings []domain.DocumentMeta,
	order domain.DocumentOrder,
) []domain.DocumentMeta {
	if len(siblings) == 0 {
		return siblings
	}
	index := make(map[string]domain.DocumentMeta, len(siblings))
	for _, meta := range siblings {
		index[meta.ID] = meta
	}
	ordered := make([]domain.DocumentMeta, 0, len(siblings))
	seen := make(map[string]struct{}, len(siblings))
	for _, id := range order.Order {
		if meta, ok := index[id]; ok {
			ordered = append(ordered, meta)
			seen[id] = struct{}{}
		}
	}
	if len(ordered) == len(siblings) {
		return ordered
	}
	rest := make([]domain.DocumentMeta, 0, len(siblings)-len(ordered))
	for _, meta := range siblings {
		if _, ok := seen[meta.ID]; ok {
			continue
		}
		rest = append(rest, meta)
	}
	sortSiblingsStable(rest)
	return append(ordered, rest...)
}

func insertIntoOrder(
	order []string,
	docID string,
	beforeID string,
	afterID string,
) ([]string, error) {
	docID = strings.TrimSpace(docID)
	if docID == "" {
		return nil, fmt.Errorf("doc id is required")
	}
	order = removeFromOrder(order, docID)
	beforeID = strings.TrimSpace(beforeID)
	afterID = strings.TrimSpace(afterID)

	if beforeID == "" && afterID == "" {
		return append(order, docID), nil
	}

	beforeIndex := indexOf(order, beforeID)
	afterIndex := indexOf(order, afterID)

	if beforeID != "" && beforeIndex == -1 {
		return nil, fmt.Errorf("before_id not found")
	}
	if afterID != "" && afterIndex == -1 {
		return nil, fmt.Errorf("after_id not found")
	}

	if beforeID != "" && afterID != "" {
		if afterIndex >= beforeIndex {
			return nil, fmt.Errorf("invalid anchor order")
		}
		return insertAt(order, beforeIndex, docID), nil
	}
	if beforeID != "" {
		return insertAt(order, beforeIndex, docID), nil
	}
	return insertAt(order, afterIndex+1, docID), nil
}

func removeFromOrder(order []string, docID string) []string {
	if docID == "" || len(order) == 0 {
		return order
	}
	out := make([]string, 0, len(order))
	for _, id := range order {
		if id == docID {
			continue
		}
		out = append(out, id)
	}
	return out
}

func indexOf(order []string, value string) int {
	if value == "" {
		return -1
	}
	for i, id := range order {
		if id == value {
			return i
		}
	}
	return -1
}

func insertAt(order []string, index int, value string) []string {
	if index < 0 {
		index = 0
	}
	if index >= len(order) {
		return append(order, value)
	}
	out := make([]string, 0, len(order)+1)
	out = append(out, order[:index]...)
	out = append(out, value)
	out = append(out, order[index:]...)
	return out
}

func sortSiblingsStable(siblings []domain.DocumentMeta) {
	sort.SliceStable(siblings, func(i, j int) bool {
		left := siblings[i]
		right := siblings[j]
		return compareMetaFallback(left, right)
	})
}

func compareMetaFallback(left, right domain.DocumentMeta) bool {
	if !left.CreatedAt.IsZero() || !right.CreatedAt.IsZero() {
		if left.CreatedAt.IsZero() {
			return false
		}
		if right.CreatedAt.IsZero() {
			return true
		}
		if !left.CreatedAt.Equal(right.CreatedAt) {
			return left.CreatedAt.Before(right.CreatedAt)
		}
	}
	if left.Slug != right.Slug {
		return left.Slug < right.Slug
	}
	return left.ID < right.ID
}

func formatParentForCommit(parentID string) string {
	parentID = normalizeParentID(parentID)
	if parentID == "" {
		return "root"
	}
	return parentID
}

func withSkipRepoPull(ctx context.Context) context.Context {
	if ctx == nil {
		return context.WithValue(context.Background(), types.RepoSkipPullKey{}, true)
	}
	return context.WithValue(ctx, types.RepoSkipPullKey{}, true)
}
