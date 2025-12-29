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

func (s *Service) CreateRaw(
	ctx context.Context,
	doc *domain.Document,
	file service.FilePayload,
) (*domain.Document, error) {
	if s == nil || s.ingestion == nil || s.repo == nil {
		return nil, fmt.Errorf("document service not initialized")
	}
	if doc == nil {
		return nil, fmt.Errorf("document is required")
	}
	if file.Reader == nil {
		return nil, fmt.Errorf("file reader is required")
	}
	if file.SizeBytes < 0 {
		return nil, fmt.Errorf("size_bytes must be >= 0")
	}

	sourceInfo, sourceRef, err := buildSourceInfo(file)
	if err != nil {
		return nil, err
	}

	docID := strings.TrimSpace(doc.ID)
	if docID == "" {
		docID = uuid.NewString()
	}
	objectKey, err := buildObjectKey(file.OriginalPath, docID, sourceInfo.Type, sourceRef)
	if err != nil {
		return nil, err
	}

	stored, err := s.ingestion.Store(ctx, ingestion.StoreInput{
		Namespace:   rawDocumentNamespace,
		ObjectKey:   objectKey,
		Reader:      file.Reader,
		Size:        file.SizeBytes,
		ContentType: strings.TrimSpace(file.MimeType),
	})
	if err != nil {
		return nil, fmt.Errorf("store raw document: %w", err)
	}

	now := time.Now()
	if s.now != nil {
		now = s.now()
	}
	storageID := ""
	if doc.StorageObject != nil {
		storageID = strings.TrimSpace(doc.StorageObject.ID)
	}
	if storageID == "" {
		storageID = uuid.NewString()
	}
	storage := &domain.StorageObject{
		ID: storageID,
		Source: domain.SourceInfo{
			Type:          sourceInfo.Type,
			UploadBatchID: sourceInfo.UploadBatchID,
			URL:           sourceInfo.URL,
			ImportedFrom:  sourceInfo.ImportedFrom,
		},
		Storage: domain.StorageInfo{
			Type:   domain.StorageTypeS3,
			Bucket: stored.Bucket,
			Key:    stored.Key,
		},
		SizeBytes: stored.Size,
		MimeType:  strings.TrimSpace(file.MimeType),
		Checksum:  stored.ETag,
		CreatedAt: now,
		UpdatedAt: now,
	}

	doc.ID = docID
	doc.Type = domain.DocumentTypeRaw
	if doc.Status == "" {
		doc.Status = domain.DocumentStatusActive
	}
	if doc.Title == "" {
		doc.Title = documentTitle(file.OriginalPath, stored.Key)
	}
	if doc.CreatedAt.IsZero() {
		doc.CreatedAt = now
	}
	doc.UpdatedAt = now
	doc.StorageObject = storage

	if err := s.repo.Insert(ctx, doc); err != nil {
		return nil, fmt.Errorf("insert document: %w", err)
	}
	return doc, nil
}

func (s *Service) Create(
	ctx context.Context,
	doc *domain.Document,
	content string,
) (*domain.Document, error) {
	_ = ctx
	_ = content
	if doc == nil {
		return nil, fmt.Errorf("document is required")
	}
	return nil, fmt.Errorf("create manual/derived document is not supported in current phase")
}

func (s *Service) Get(ctx context.Context, id string) (*domain.Document, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("document service not initialized")
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("id is required")
	}
	docs, _, err := s.repo.List(ctx, repository.DocumentFilter{
		ID:                   id,
		PreloadStorageObject: true,
	}, 1, 0)
	if err != nil {
		return nil, fmt.Errorf("get document: %w", err)
	}
	if len(docs) == 0 {
		return nil, fmt.Errorf("document not found")
	}
	return &docs[0], nil
}

func (s *Service) ListByParent(ctx context.Context, parentID *string) ([]*domain.Document, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("document service not initialized")
	}
	filter := repository.DocumentFilter{}
	if parentID == nil {
		filter.ParentID = ""
	} else {
		filter.ParentID = strings.TrimSpace(*parentID)
	}
	docs, _, err := s.repo.List(ctx, filter, 0, 0)
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}
	return toDocumentPointers(docs), nil
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

	docs, _, err := s.repo.List(ctx, repository.DocumentFilter{
		ProjectID: root.ProjectID,
	}, 0, 0)
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}

	byID := make(map[string]*domain.Document, len(docs))
	children := make(map[string][]*domain.Document)
	for i := range docs {
		doc := &docs[i]
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

func (s *Service) SimplifiedTree(ctx context.Context, projectID string) ([]*domain.Document, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("document service not initialized")
	}
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, fmt.Errorf("project_id is required")
	}
	docs, _, err := s.repo.List(ctx, repository.DocumentFilter{
		ProjectID: projectID,
	}, 0, 0)
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}
	return toDocumentPointers(docs), nil
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

func buildSourceInfo(payload service.FilePayload) (domain.SourceInfo, string, error) {
	sourceType, err := normalizeSourceType(payload.SourceType)
	if err != nil {
		return domain.SourceInfo{}, "", err
	}
	ref := strings.TrimSpace(payload.SourceRef)
	info := domain.SourceInfo{Type: sourceType}
	switch sourceType {
	case domain.SourceTypeUpload:
		info.UploadBatchID = ref
	case domain.SourceTypeURL:
		if ref == "" {
			return domain.SourceInfo{}, "", fmt.Errorf("source_ref is required for url source")
		}
		info.URL = ref
	case domain.SourceTypeImport:
		info.ImportedFrom = ref
	}
	return info, ref, nil
}

func normalizeSourceType(value domain.SourceType) (domain.SourceType, error) {
	if value == "" {
		return domain.SourceTypeUpload, nil
	}
	switch value {
	case domain.SourceTypeUpload, domain.SourceTypeURL, domain.SourceTypeImport:
		return value, nil
	default:
		return "", fmt.Errorf("invalid source_type: %s", value)
	}
}

func buildObjectKey(
	originalPath string,
	fallback string,
	sourceType domain.SourceType,
	sourceRef string,
) (string, error) {
	key, err := cleanObjectKey(originalPath)
	if err != nil {
		return "", err
	}
	if key == "" {
		key, err = cleanObjectKey(fallback)
		if err != nil {
			return "", err
		}
	}
	if key == "" {
		return "", fmt.Errorf("object key is required")
	}
	if sourceType == domain.SourceTypeUpload && strings.TrimSpace(sourceRef) != "" {
		prefix, err := cleanObjectKey(sourceRef)
		if err != nil {
			return "", err
		}
		if prefix != "" {
			key = path.Join(prefix, key)
		}
	}
	return key, nil
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

func toDocumentPointers(docs []domain.Document) []*domain.Document {
	items := make([]*domain.Document, 0, len(docs))
	for i := range docs {
		items = append(items, &docs[i])
	}
	return items
}

var _ service.DocumentService = (*Service)(nil)
