package embedding

import (
	"context"
	"fmt"
	"strings"

	"zeus/internal/domain"
	"zeus/internal/infra/embedding"
	documentservice "zeus/internal/modules/document/service"
	knowledgeservice "zeus/internal/modules/knowledge/service"
	"zeus/internal/repository"
)

type Service struct {
	embedder   embedding.Embedder
	repo       repository.KnowledgeEmbeddingRepository
	docService documentservice.DocumentService
}

func NewService(embedder embedding.Embedder, repo repository.KnowledgeEmbeddingRepository, docService documentservice.DocumentService) *Service {
	return &Service{embedder: embedder, repo: repo, docService: docService}
}

func (s *Service) Build(ctx context.Context, req knowledgeservice.IndexBuildRequest) error {
	if s == nil || s.repo == nil || s.embedder == nil {
		return fmt.Errorf("embedding service not initialized")
	}
	if err := validateIndexSpec(req.Index); err != nil {
		return err
	}
	projectKey := strings.TrimSpace(req.ProjectKey)
	if projectKey == "" {
		return fmt.Errorf("project key is required")
	}
	if req.Index.Kind != knowledgeservice.IndexEmbedding {
		return fmt.Errorf("unsupported index kind: %s", req.Index.Kind)
	}
	if req.FullRebuild {
		// Best-effort: delete per doc below; no bulk delete yet.
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
	if s == nil || s.repo == nil || s.embedder == nil {
		return fmt.Errorf("embedding service not initialized")
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
	if index.Kind != knowledgeservice.IndexEmbedding {
		return fmt.Errorf("unsupported index kind: %s", index.Kind)
	}
	chunks := BuildChunks(doc)
	if len(chunks) == 0 {
		return nil
	}
	inputs := make([]string, 0, len(chunks))
	for _, chunk := range chunks {
		inputs = append(inputs, chunk.Content)
	}
	vectors, err := s.embedder.Embed(ctx, inputs)
	if err != nil {
		return err
	}
	if len(vectors) != len(chunks) {
		return fmt.Errorf("embedding size mismatch")
	}
	entries := make([]repository.EmbeddingChunk, 0, len(chunks))
	for idx, chunk := range chunks {
		entries = append(entries, repository.EmbeddingChunk{
			DocID:      chunk.DocID,
			BlockID:    chunk.BlockID,
			ChunkIndex: chunk.ChunkIndex,
			Content:    chunk.Content,
			Model:      index.Model,
			Vector:     vectors[idx],
			Metadata: map[string]any{
				"doc_id":   chunk.DocID,
				"block_id": chunk.BlockID,
				"chunk":    chunk.ChunkIndex,
				"title":    doc.Meta.Title,
				"path":     doc.Meta.Path,
			},
		})
	}
	return s.repo.UpsertChunks(ctx, projectKey, index.Name, entries)
}

func (s *Service) Remove(ctx context.Context, projectKey string, index knowledgeservice.IndexSpec, docID string) error {
	if s == nil || s.repo == nil {
		return fmt.Errorf("embedding service not initialized")
	}
	if err := validateIndexSpec(index); err != nil {
		return err
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return fmt.Errorf("project key is required")
	}
	if index.Kind != knowledgeservice.IndexEmbedding {
		return fmt.Errorf("unsupported index kind: %s", index.Kind)
	}
	return s.repo.DeleteByDoc(ctx, projectKey, index.Name, docID)
}

func (s *Service) Search(ctx context.Context, projectKey string, index knowledgeservice.IndexSpec, query knowledgeservice.SearchQuery) ([]knowledgeservice.SearchResult, error) {
	if s == nil || s.repo == nil || s.embedder == nil {
		return nil, fmt.Errorf("embedding service not initialized")
	}
	if err := validateIndexSpec(index); err != nil {
		return nil, err
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return nil, fmt.Errorf("project key is required")
	}
	if index.Kind != knowledgeservice.IndexEmbedding {
		return nil, fmt.Errorf("unsupported index kind: %s", index.Kind)
	}
	if query.Mode != "" && query.Mode != knowledgeservice.SearchEmbedding {
		return nil, fmt.Errorf("unsupported search mode: %s", query.Mode)
	}
	vector := query.Vector
	if len(vector) == 0 {
		text := strings.TrimSpace(query.Text)
		if text == "" {
			return []knowledgeservice.SearchResult{}, nil
		}
		vectors, err := s.embedder.Embed(ctx, []string{text})
		if err != nil {
			return nil, err
		}
		if len(vectors) == 0 {
			return []knowledgeservice.SearchResult{}, nil
		}
		vector = vectors[0]
	}
	results, err := s.repo.SearchByVector(ctx, projectKey, index.Name, vector, query.Limit, query.Offset)
	if err != nil {
		return nil, err
	}
	resp := make([]knowledgeservice.SearchResult, 0, len(results))
	for _, item := range results {
		resp = append(resp, knowledgeservice.SearchResult{
			DocID:    item.DocID,
			Score:    item.Score,
			Snippet:  item.Content,
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
	index := knowledgeservice.IndexSpec{Kind: knowledgeservice.IndexEmbedding, Name: projectKey}
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
