package rag

import (
	"context"
	"encoding/json"
	"testing"

	domainrag "zeus/internal/domain/rag"
	"zeus/internal/repository"
	"zeus/internal/repository/ragindex"
)

type fakeReader struct {
	docs map[string]repository.Document
}

func (f *fakeReader) ListDocuments(ctx context.Context, projectID string) ([]repository.DocumentRef, error) {
	refs := make([]repository.DocumentRef, 0, len(f.docs))
	for _, doc := range f.docs {
		refs = append(refs, repository.DocumentRef{DocID: doc.DocID})
	}
	return refs, nil
}

func (f *fakeReader) ReadDocument(ctx context.Context, projectID, docID string) (repository.Document, error) {
	return f.docs[docID], nil
}

type fakeEmbedder struct{}

func (fakeEmbedder) Embed(ctx context.Context, inputs []string) ([][]float32, error) {
	vectors := make([][]float32, 0, len(inputs))
	for _, input := range inputs {
		vectors = append(vectors, []float32{float32(len(input))})
	}
	return vectors, nil
}

func TestSimpleBlockExtractor(t *testing.T) {
	payload := map[string]interface{}{
		"content": map[string]interface{}{
			"type": "doc",
			"content": []interface{}{
				map[string]interface{}{
					"type": "paragraph",
					"content": []interface{}{
						map[string]interface{}{"type": "text", "text": "This is a test paragraph for rag extraction."},
					},
				},
			},
		},
	}
	data, _ := json.Marshal(payload)
	doc := repository.Document{ProjectID: "p1", DocID: "d1", ContentJSON: data}
	extractor := SimpleBlockExtractor{}
	units, err := extractor.Extract(context.Background(), doc)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if len(units) != 1 {
		t.Fatalf("expected 1 unit, got %d", len(units))
	}
	if units[0].UnitID == "" || units[0].Hash == "" {
		t.Fatalf("unit id/hash not set")
	}
}

func TestRebuildAndSearch(t *testing.T) {
	payload := map[string]interface{}{
		"content": map[string]interface{}{
			"type": "doc",
			"content": []interface{}{
				map[string]interface{}{
					"type": "paragraph",
					"content": []interface{}{
						map[string]interface{}{"type": "text", "text": "Hello RAG world with enough text."},
					},
				},
			},
		},
	}
	data, _ := json.Marshal(payload)
	docs := map[string]repository.Document{
		"doc-1": {ProjectID: "proj-1", DocID: "doc-1", ContentJSON: data},
	}
	reader := &fakeReader{docs: docs}
	index := ragindex.NewMemoryIndex()
	service := NewService(reader, SimpleBlockExtractor{}, fakeEmbedder{}, index, SimpleAssembler{})

	report, err := service.RebuildProject(context.Background(), "proj-1")
	if err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	if report.IndexedUnits == 0 {
		t.Fatalf("expected indexed units")
	}

	result, err := service.Search(context.Background(), domainrag.RAGQuery{
		ProjectID: "proj-1",
		Text:      "RAG world",
		TopK:      3,
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(result.Matches) == 0 {
		t.Fatalf("expected search matches")
	}
}
