package rag

import (
	"context"
	"testing"
	"time"

	domainrag "zeus/internal/domain/rag"
	"zeus/internal/infra/embedding"
	"zeus/internal/infra/llm"
	"zeus/internal/repository"
	"zeus/internal/repository/ragsummary"
)

type fakeDocReader struct {
	doc repository.Document
}

func (f fakeDocReader) ListDocuments(ctx context.Context, projectID string) ([]repository.DocumentRef, error) {
	return []repository.DocumentRef{}, nil
}

func (f fakeDocReader) ReadDocument(ctx context.Context, projectID, docID string) (repository.Document, error) {
	return f.doc, nil
}

type fakeExtractor struct {
	units []domainrag.RAGUnit
}

func (f fakeExtractor) Extract(ctx context.Context, doc repository.Document) ([]domainrag.RAGUnit, error) {
	return f.units, nil
}

type fakeSummaryRepo struct {
	summary     *domainrag.DocumentSummary
	getCalls    int
	upsertCalls int
}

func (f *fakeSummaryRepo) Get(
	ctx context.Context,
	projectID, docID string,
) (*domainrag.DocumentSummary, bool, error) {
	f.getCalls++
	if f.summary == nil {
		return nil, false, nil
	}
	return f.summary, true, nil
}

func (f *fakeSummaryRepo) Upsert(ctx context.Context, summary *domainrag.DocumentSummary) error {
	f.upsertCalls++
	f.summary = summary
	return nil
}

func (f *fakeSummaryRepo) DeleteByProject(ctx context.Context, projectID string) error {
	f.summary = nil
	return nil
}

func (f *fakeSummaryRepo) DeleteByDoc(ctx context.Context, projectID, docID string) error {
	f.summary = nil
	return nil
}

type fakeLLM struct {
	calls  int
	result string
}

func (f *fakeLLM) Chat(
	ctx context.Context,
	runtime embedding.ModelRuntime,
	messages []llm.Message,
	maxTokens int,
) (string, error) {
	f.calls++
	return f.result, nil
}

type fakeRuntimeResolver struct {
	runtime embedding.ModelRuntime
}

func (f fakeRuntimeResolver) Resolve(ctx context.Context, scenario string) (embedding.ModelRuntime, error) {
	return f.runtime, nil
}

func TestGenerateDocumentSummary_NoChange(t *testing.T) {
	units := []domainrag.RAGUnit{
		{Content: "This is a stable content block for summary."},
	}
	input := buildSummaryInput(units)
	hash := hashSummaryContent(input)
	existing := &domainrag.DocumentSummary{
		ID:          "summary-1",
		ProjectID:   "p1",
		DocID:       "d1",
		SummaryText: "Existing summary",
		ContentHash: hash,
		ModelRef:    "runtime-1",
		CreatedAt:   time.Now().Add(-time.Hour),
		UpdatedAt:   time.Now().Add(-time.Minute),
	}

	repo := &fakeSummaryRepo{summary: existing}
	llmClient := &fakeLLM{result: "New summary"}
	service := NewSummaryService(
		fakeDocReader{},
		fakeExtractor{units: units},
		repo,
		llmClient,
		fakeRuntimeResolver{runtime: embedding.ModelRuntime{ID: "runtime-1"}},
	)

	summary, err := service.GenerateDocumentSummary(context.Background(), "p1", "d1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if summary.ID != existing.ID {
		t.Fatalf("expected existing summary to be returned")
	}
	if llmClient.calls != 0 {
		t.Fatalf("expected no llm calls, got %d", llmClient.calls)
	}
	if repo.upsertCalls != 0 {
		t.Fatalf("expected no upsert calls, got %d", repo.upsertCalls)
	}
}

func TestGenerateDocumentSummary_ContentChanged(t *testing.T) {
	units := []domainrag.RAGUnit{
		{Content: "New content that changes the hash."},
	}
	existing := &domainrag.DocumentSummary{
		ID:          "summary-1",
		ProjectID:   "p1",
		DocID:       "d1",
		SummaryText: "Existing summary",
		ContentHash: "old-hash",
		ModelRef:    "runtime-1",
		CreatedAt:   time.Now().Add(-time.Hour),
		UpdatedAt:   time.Now().Add(-time.Minute),
	}

	repo := &fakeSummaryRepo{summary: existing}
	llmClient := &fakeLLM{result: "New summary"}
	service := NewSummaryService(
		fakeDocReader{},
		fakeExtractor{units: units},
		repo,
		llmClient,
		fakeRuntimeResolver{runtime: embedding.ModelRuntime{ID: "runtime-2"}},
	)

	summary, err := service.GenerateDocumentSummary(context.Background(), "p1", "d1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if summary.SummaryText != "New summary" {
		t.Fatalf("expected summary to be regenerated")
	}
	if llmClient.calls != 1 {
		t.Fatalf("expected 1 llm call, got %d", llmClient.calls)
	}
	if repo.upsertCalls != 1 {
		t.Fatalf("expected 1 upsert call, got %d", repo.upsertCalls)
	}
}

func TestGenerateDocumentSummary_AfterDelete(t *testing.T) {
	units := []domainrag.RAGUnit{
		{Content: "Fresh content after delete."},
	}

	repo := &fakeSummaryRepo{}
	if err := repo.DeleteByDoc(context.Background(), "p1", "d1"); err != nil {
		t.Fatalf("delete failed: %v", err)
	}

	llmClient := &fakeLLM{result: "Fresh summary"}
	service := NewSummaryService(
		fakeDocReader{},
		fakeExtractor{units: units},
		repo,
		llmClient,
		fakeRuntimeResolver{runtime: embedding.ModelRuntime{ID: "runtime-3"}},
	)

	summary, err := service.GenerateDocumentSummary(context.Background(), "p1", "d1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if summary == nil || summary.SummaryText != "Fresh summary" {
		t.Fatalf("expected summary to be regenerated")
	}
	if llmClient.calls != 1 {
		t.Fatalf("expected 1 llm call, got %d", llmClient.calls)
	}
	if repo.upsertCalls != 1 {
		t.Fatalf("expected 1 upsert call, got %d", repo.upsertCalls)
	}
}

var _ ragsummary.DocumentSummaryRepository = (*fakeSummaryRepo)(nil)
