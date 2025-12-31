package document

import (
	"context"
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"

	"zeus/internal/domain"
	"zeus/internal/infra/ingestion"
	"zeus/internal/repository"
	"zeus/internal/service"
)

const rawDocumentNamespace = "raw-documents"

type Service struct {
	ingestion ingestion.FileIngestionService
	repo      repository.DocumentRepository
	now       func() time.Time
}

func NewService(
	ingestionSvc ingestion.FileIngestionService,
	repo repository.DocumentRepository,
) (*Service, error) {
	if ingestionSvc == nil {
		return nil, fmt.Errorf("ingestion service is required")
	}
	if repo == nil {
		return nil, fmt.Errorf("document repository is required")
	}
	return &Service{
		ingestion: ingestionSvc,
		repo:      repo,
		now:       time.Now,
	}, nil
}

func (s *Service) Create(
	ctx context.Context,
	doc *domain.Document,
	content string,
) (*domain.Document, error) {
	_ = ctx
	_ = content
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("document service not initialized")
	}
	if doc == nil {
		return nil, fmt.Errorf("document is required")
	}
	doc.ProjectID = strings.TrimSpace(doc.ProjectID)
	if doc.ProjectID == "" {
		return nil, fmt.Errorf("project id is required")
	}
	if strings.TrimSpace(doc.Title) == "" {
		return nil, fmt.Errorf("title is required")
	}
	storageID := ""
	if doc.StorageObject != nil {
		storageID = strings.TrimSpace(doc.StorageObject.ID)
	}
	if storageID == "" {
		return nil, fmt.Errorf("storage object id is required")
	}
	if strings.TrimSpace(doc.ID) == "" {
		doc.ID = uuid.NewString()
	}
	if doc.Type == "" {
		doc.Type = domain.DocumentTypeOrigin
	}
	if doc.Status == "" {
		doc.Status = domain.DocumentStatusActive
	}
	if strings.TrimSpace(doc.Path) == "" {
		doc.Path = path.Join("/", "doc", doc.ID)
	}
	if doc.Parent != nil {
		parentID := strings.TrimSpace(doc.Parent.ID)
		if parentID == "" {
			doc.Parent = nil
		} else {
			doc.Parent = &domain.Document{ID: parentID}
		}
	}
	doc.StorageObject = &domain.StorageObject{ID: storageID}

	now := time.Now()
	if s.now != nil {
		now = s.now()
	}
	if doc.CreatedAt.IsZero() {
		doc.CreatedAt = now
	}
	doc.UpdatedAt = now

	if err := s.repo.Insert(ctx, doc); err != nil {
		return nil, fmt.Errorf("insert document: %w", err)
	}
	return doc, nil
}

func (s *Service) Get(ctx context.Context, id string) (*domain.Document, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("document service not initialized")
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("id is required")
	}
	doc, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("get document: %w", err)
	}
	if doc == nil {
		return nil, fmt.Errorf("document not found")
	}
	return doc, nil
}

func (s *Service) GetProjectRootID(ctx context.Context, projectID string) (string, error) {
	// TODO
	if s == nil || s.repo == nil {
		return "", fmt.Errorf("document service not initialized")
	}
	return "", nil
}

func (s *Service) ListByParent(ctx context.Context, parentID string) ([]*domain.Document, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("document service not initialized")
	}
	filter := repository.DocumentFilter{}
	option := repository.DocumentOption{}
	parentID = strings.TrimSpace(parentID)
	filter.ParentID = &parentID
	docs, _, err := s.repo.List(ctx, filter, option)
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}
	return docs, nil
}

func (s *Service) GetSubtree(ctx context.Context, rootID string) ([]*domain.Document, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("document service not initialized")
	}
	rootID = strings.TrimSpace(rootID)
	if rootID == "" {
		return nil, fmt.Errorf("root id is required")
	}
	root, err := s.Get(ctx, rootID)
	if err != nil {
		return nil, err
	}
	if root.ProjectID == "" {
		return []*domain.Document{root}, nil
	}

	filter := repository.DocumentFilter{ProjectID: root.ProjectID}
	option := repository.DocumentOption{}
	docs, _, err := s.repo.List(ctx, filter, option)
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}

	byID := make(map[string]*domain.Document, len(docs))
	children := make(map[string][]*domain.Document)
	for _, doc := range docs {
		byID[doc.ID] = doc
		parent := ""
		if doc.Parent != nil {
			parent = doc.Parent.ID
		}
		children[parent] = append(children[parent], doc)
	}

	start := root
	if found, ok := byID[rootID]; ok {
		start = found
	}

	result := make([]*domain.Document, 0, len(docs)+1)
	queue := []*domain.Document{start}
	seen := map[string]struct{}{}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		if current == nil {
			continue
		}
		if _, ok := seen[current.ID]; ok {
			continue
		}
		seen[current.ID] = struct{}{}
		result = append(result, current)
		queue = append(queue, children[current.ID]...)
	}

	return result, nil
}

func (s *Service) Move(ctx context.Context, id string, newParentID *string) error {
	if s == nil || s.repo == nil {
		return fmt.Errorf("document service not initialized")
	}
	doc, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	if newParentID == nil {
		doc.Parent = nil
	} else {
		parentID := strings.TrimSpace(*newParentID)
		doc.Parent = &domain.Document{ID: parentID}
	}
	doc.UpdatedAt = time.Now()
	if s.now != nil {
		doc.UpdatedAt = s.now()
	}
	if err := s.repo.Save(ctx, doc); err != nil {
		return fmt.Errorf("save document: %w", err)
	}
	return nil
}

func (s *Service) Reorder(ctx context.Context, id string, newOrder int) error {
	if s == nil || s.repo == nil {
		return fmt.Errorf("document service not initialized")
	}
	doc, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	doc.Order = newOrder
	doc.UpdatedAt = time.Now()
	if s.now != nil {
		doc.UpdatedAt = s.now()
	}
	if err := s.repo.Save(ctx, doc); err != nil {
		return fmt.Errorf("save document: %w", err)
	}
	return nil
}

func (s *Service) UpdateContent(ctx context.Context, id string, content string) error {
	_ = ctx
	_ = id
	_ = content
	return fmt.Errorf("update content is not supported in current phase")
}

func (s *Service) Archive(ctx context.Context, id string) error {
	if s == nil || s.repo == nil {
		return fmt.Errorf("document service not initialized")
	}
	doc, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	doc.Status = domain.DocumentStatusArchived
	doc.UpdatedAt = time.Now()
	if s.now != nil {
		doc.UpdatedAt = s.now()
	}
	if err := s.repo.Save(ctx, doc); err != nil {
		return fmt.Errorf("save document: %w", err)
	}
	return nil
}

func cleanObjectKey(value string) (string, error) {
	if strings.TrimSpace(value) == "" {
		return "", nil
	}
	normalized := strings.ReplaceAll(value, "\\", "/")
	cleaned := path.Clean(normalized)
	cleaned = strings.TrimPrefix(cleaned, "/")
	if cleaned == "." {
		return "", nil
	}
	if strings.HasPrefix(cleaned, "..") || strings.Contains(cleaned, "/..") {
		return "", fmt.Errorf("object key must not contain ..")
	}
	return cleaned, nil
}

func documentTitle(originalPath, objectKey string) string {
	originalPath = strings.TrimSpace(originalPath)
	if originalPath != "" {
		return path.Base(normalizePath(originalPath))
	}
	objectKey = strings.TrimSpace(objectKey)
	if objectKey != "" {
		return path.Base(normalizePath(objectKey))
	}
	return ""
}

func normalizePath(value string) string {
	normalized := strings.ReplaceAll(value, "\\", "/")
	cleaned := path.Clean(normalized)
	if cleaned == "." {
		return ""
	}
	return cleaned
}

var _ service.DocumentService = (*Service)(nil)
