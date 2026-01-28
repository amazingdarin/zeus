package knowledge

import (
	"context"
	"fmt"
	"strings"

	"zeus/internal/domain"
	documentservice "zeus/internal/modules/document/service"
	knowledgeservice "zeus/internal/modules/knowledge/service"
	"zeus/internal/repository"
)

type Service struct {
	fulltextRepo repository.KnowledgeFulltextRepository
	docService   documentservice.DocumentService
}

func NewService(repos repository.Repository, docService documentservice.DocumentService) *Service {
	return &Service{
		fulltextRepo: repos.KnowledgeFulltext,
		docService:   docService,
	}
}

func (s *Service) Build(ctx context.Context, req knowledgeservice.IndexBuildRequest) error {
	if s == nil || s.fulltextRepo == nil {
		return fmt.Errorf("knowledge service not initialized")
	}
	if err := validateIndexSpec(req.Index); err != nil {
		return err
	}
	projectKey := strings.TrimSpace(req.ProjectKey)
	if projectKey == "" {
		return fmt.Errorf("project key is required")
	}
	if req.Index.Kind != knowledgeservice.IndexFulltext {
		return fmt.Errorf("unsupported index kind: %s", req.Index.Kind)
	}
	if req.FullRebuild {
		if err := s.fulltextRepo.DeleteByIndex(ctx, projectKey, req.Index.Name); err != nil {
			return fmt.Errorf("clear fulltext index: %w", err)
		}
	}
	for _, doc := range req.Docs {
		if doc == nil {
			continue
		}
		if err := s.Upsert(ctx, projectKey, req.Index, doc); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) Upsert(ctx context.Context, projectKey string, index knowledgeservice.IndexSpec, doc *domain.Document) error {
	if s == nil || s.fulltextRepo == nil {
		return fmt.Errorf("knowledge service not initialized")
	}
	if err := validateIndexSpec(index); err != nil {
		return err
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return fmt.Errorf("project key is required")
	}
	if doc == nil {
		return fmt.Errorf("document is required")
	}
	if index.Kind != knowledgeservice.IndexFulltext {
		return fmt.Errorf("unsupported index kind: %s", index.Kind)
	}
	contentPlain := extractDocumentText(doc)
	metadata := map[string]any{
		"title": doc.Meta.Title,
		"path":  doc.Meta.Path,
	}
	return s.fulltextRepo.Upsert(
		ctx,
		projectKey,
		index.Name,
		strings.TrimSpace(doc.Meta.ID),
		strings.TrimSpace(doc.Meta.Title),
		contentPlain,
		metadata,
	)
}

func (s *Service) Remove(ctx context.Context, projectKey string, index knowledgeservice.IndexSpec, docID string) error {
	if s == nil || s.fulltextRepo == nil {
		return fmt.Errorf("knowledge service not initialized")
	}
	if err := validateIndexSpec(index); err != nil {
		return err
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return fmt.Errorf("project key is required")
	}
	if index.Kind != knowledgeservice.IndexFulltext {
		return fmt.Errorf("unsupported index kind: %s", index.Kind)
	}
	return s.fulltextRepo.Delete(ctx, projectKey, index.Name, docID)
}

func (s *Service) Search(ctx context.Context, projectKey string, index knowledgeservice.IndexSpec, query knowledgeservice.SearchQuery) ([]knowledgeservice.SearchResult, error) {
	if s == nil || s.fulltextRepo == nil {
		return nil, fmt.Errorf("knowledge service not initialized")
	}
	if err := validateIndexSpec(index); err != nil {
		return nil, err
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return nil, fmt.Errorf("project key is required")
	}
	if index.Kind != knowledgeservice.IndexFulltext {
		return nil, fmt.Errorf("unsupported index kind: %s", index.Kind)
	}
	if query.Mode != "" && query.Mode != knowledgeservice.SearchFulltext {
		return nil, fmt.Errorf("unsupported search mode: %s", query.Mode)
	}
	queryText := strings.TrimSpace(query.Text)
	if queryText == "" {
		return []knowledgeservice.SearchResult{}, nil
	}
	var results []repository.FulltextSearchResult
	var err error
	if query.Fuzzy {
		results, err = s.fulltextRepo.FuzzySearch(
			ctx,
			projectKey,
			index.Name,
			queryText,
			query.MinSimilarity,
			query.Limit,
			query.Offset,
		)
	} else {
		lang := detectLanguage(queryText)
		results, err = s.fulltextRepo.Search(
			ctx,
			projectKey,
			index.Name,
			lang,
			queryText,
			query.Filters,
			query.Limit,
			query.Offset,
			query.Highlight,
			query.SortBy,
		)
	}
	if err != nil {
		return nil, err
	}
	resp := make([]knowledgeservice.SearchResult, 0, len(results))
	for _, item := range results {
		resp = append(resp, knowledgeservice.SearchResult{
			DocID:    item.DocID,
			Score:    item.Score,
			Snippet:  item.Snippet,
			Metadata: stringMap(item.Metadata),
		})
	}
	return resp, nil
}

func (s *Service) upsertAsync(ctx context.Context, projectKey string, index knowledgeservice.IndexSpec, doc *domain.Document) {
	_ = s.Upsert(ctx, projectKey, index, doc)
}

func (s *Service) removeAsync(ctx context.Context, projectKey string, index knowledgeservice.IndexSpec, docID string) {
	_ = s.Remove(ctx, projectKey, index, docID)
}

func (s *Service) upsertByIDAsync(ctx context.Context, projectKey string, docID string) {
	if s == nil || s.docService == nil {
		return
	}
	doc, err := s.docService.Get(ctx, projectKey, docID)
	if err != nil {
		return
	}
	index := knowledgeservice.IndexSpec{Kind: knowledgeservice.IndexFulltext, Name: projectKey}
	_ = s.Upsert(ctx, projectKey, index, doc)
}

func validateIndexSpec(index knowledgeservice.IndexSpec) error {
	if strings.TrimSpace(index.Name) == "" {
		return fmt.Errorf("index name is required")
	}
	if strings.TrimSpace(string(index.Kind)) == "" {
		return fmt.Errorf("index kind is required")
	}
	return nil
}

func detectLanguage(text string) repository.FulltextLanguage {
	for _, r := range text {
		if r > 127 {
			return repository.FulltextChinese
		}
	}
	return repository.FulltextEnglish
}

func stringMap(input map[string]any) map[string]string {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]string, len(input))
	for key, value := range input {
		if key == "" || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			output[key] = typed
		default:
			output[key] = fmt.Sprintf("%v", typed)
		}
	}
	if len(output) == 0 {
		return nil
	}
	return output
}

var _ knowledgeservice.KnowledgeIndexService = (*Service)(nil)
var _ knowledgeservice.KnowledgeSearchService = (*Service)(nil)
