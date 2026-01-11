package rag

import (
	"context"
	"fmt"
	"strings"
	"time"

	domainrag "zeus/internal/domain/rag"
	"zeus/internal/infra/embedding"
	"zeus/internal/repository"
	"zeus/internal/repository/ragindex"
)

// Service orchestrates RAG indexing, search, and context assembly.
// It is presentation-agnostic and can be reused by HTTP, MCP, CLI, or Jobs.
type Service struct {
	reader    repository.DocumentReader
	extractor RAGExtractor
	embedder  embedding.Embedder
	index     ragindex.KnowledgeIndex
	assembler ContextAssembler
	batchSize int
}

func NewService(
	reader repository.DocumentReader,
	extractor RAGExtractor,
	embedder embedding.Embedder,
	index ragindex.KnowledgeIndex,
	assembler ContextAssembler,
) *Service {
	if extractor == nil {
		extractor = SimpleBlockExtractor{}
	}
	if assembler == nil {
		assembler = SimpleAssembler{}
	}
	return &Service{
		reader:    reader,
		extractor: extractor,
		embedder:  embedder,
		index:     index,
		assembler: assembler,
		batchSize: 32,
	}
}

// RebuildProject deletes derived data then rebuilds all units from Git.
// Rebuild keeps the index consistent because RAG data is not a source of truth.
func (s *Service) RebuildProject(ctx context.Context, projectID string) (domainrag.RAGRebuildReport, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return domainrag.RAGRebuildReport{}, fmt.Errorf("project id is required")
	}
	start := time.Now()
	report := domainrag.RAGRebuildReport{ProjectID: projectID}

	if err := s.index.DeleteByProject(ctx, projectID); err != nil {
		return report, fmt.Errorf("delete project index: %w", err)
	}
	refs, err := s.reader.ListDocuments(ctx, projectID)
	if err != nil {
		return report, err
	}
	report.TotalDocs = len(refs)
	for _, ref := range refs {
		units, err := s.rebuildDoc(ctx, projectID, ref.DocID)
		if err != nil {
			report.FailedDocs++
			report.Errors = append(report.Errors, err.Error())
			continue
		}
		report.IndexedUnits += units
	}
	report.Duration = time.Since(start)
	return report, nil
}

// RebuildDocument deletes derived units for a document and rebuilds it from Git.
func (s *Service) RebuildDocument(ctx context.Context, projectID, docID string) (domainrag.RAGRebuildReport, error) {
	projectID = strings.TrimSpace(projectID)
	docID = strings.TrimSpace(docID)
	if projectID == "" {
		return domainrag.RAGRebuildReport{}, fmt.Errorf("project id is required")
	}
	if docID == "" {
		return domainrag.RAGRebuildReport{}, fmt.Errorf("doc id is required")
	}
	start := time.Now()
	report := domainrag.RAGRebuildReport{ProjectID: projectID, DocID: docID, TotalDocs: 1}
	units, err := s.rebuildDoc(ctx, projectID, docID)
	if err != nil {
		report.FailedDocs = 1
		report.Errors = append(report.Errors, err.Error())
		report.Duration = time.Since(start)
		return report, err
	}
	report.IndexedUnits = units
	report.Duration = time.Since(start)
	return report, nil
}

func (s *Service) Search(ctx context.Context, query domainrag.RAGQuery) (domainrag.RAGSearchResult, error) {
	query.ProjectID = strings.TrimSpace(query.ProjectID)
	query.Text = strings.TrimSpace(query.Text)
	if query.ProjectID == "" {
		return domainrag.RAGSearchResult{}, fmt.Errorf("project id is required")
	}
	if query.Text == "" {
		return domainrag.RAGSearchResult{}, fmt.Errorf("query text is required")
	}
	if query.TopK <= 0 {
		query.TopK = 5
	}
	vectors, err := s.embedder.Embed(ctx, []string{query.Text})
	if err != nil {
		return domainrag.RAGSearchResult{}, err
	}
	if len(vectors) == 0 {
		return domainrag.RAGSearchResult{Matches: []domainrag.RAGMatch{}}, nil
	}
	filter := ragindex.IndexFilter{
		DocIDPrefix: query.Filters.DocIDPrefix,
		PathPrefix:  query.Filters.PathPrefix,
	}
	hits, err := s.index.Search(ctx, query.ProjectID, vectors[0], query.TopK, filter)
	if err != nil {
		return domainrag.RAGSearchResult{}, err
	}
	matches := make([]domainrag.RAGMatch, 0, len(hits))
	for _, hit := range hits {
		matches = append(matches, domainrag.RAGMatch{Unit: hit.Unit, Score: hit.Score})
	}
	return domainrag.RAGSearchResult{Matches: matches}, nil
}

func (s *Service) BuildContext(ctx context.Context, query domainrag.RAGQuery) (domainrag.RAGContextBundle, error) {
	result, err := s.Search(ctx, query)
	if err != nil {
		return domainrag.RAGContextBundle{}, err
	}
	return s.assembler.Assemble(ctx, query, result.Matches)
}

func (s *Service) rebuildDoc(ctx context.Context, projectID, docID string) (int, error) {
	if err := s.index.DeleteByDoc(ctx, projectID, docID); err != nil {
		return 0, fmt.Errorf("delete doc index: %w", err)
	}
	doc, err := s.reader.ReadDocument(ctx, projectID, docID)
	if err != nil {
		return 0, err
	}
	units, err := s.extractor.Extract(ctx, doc)
	if err != nil {
		return 0, fmt.Errorf("extract units: %w", err)
	}
	if len(units) == 0 {
		return 0, nil
	}
	indexed, err := s.embedUnits(ctx, units)
	if err != nil {
		return 0, err
	}
	if err := s.index.Upsert(ctx, indexed); err != nil {
		return 0, fmt.Errorf("upsert units: %w", err)
	}
	return len(units), nil
}

func (s *Service) embedUnits(ctx context.Context, units []domainrag.RAGUnit) ([]ragindex.IndexedUnit, error) {
	items := make([]ragindex.IndexedUnit, 0, len(units))
	batchSize := s.batchSize
	if batchSize <= 0 {
		batchSize = 32
	}
	for start := 0; start < len(units); start += batchSize {
		end := start + batchSize
		if end > len(units) {
			end = len(units)
		}
		batch := units[start:end]
		inputs := make([]string, 0, len(batch))
		for _, unit := range batch {
			inputs = append(inputs, unit.Content)
		}
		vectors, err := s.embedder.Embed(ctx, inputs)
		if err != nil {
			return nil, err
		}
		if len(vectors) != len(batch) {
			return nil, fmt.Errorf("embedding output mismatch")
		}
		for i, unit := range batch {
			items = append(items, ragindex.IndexedUnit{Unit: unit, Vector: vectors[i]})
		}
	}
	return items, nil
}
