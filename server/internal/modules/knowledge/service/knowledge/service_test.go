package knowledge

import (
	"context"
	"strings"
	"testing"

	"zeus/internal/domain"
	"zeus/internal/modules/knowledge/service"
	"zeus/internal/repository"
)

type fakeFulltextRepo struct {
	upsertCalls    int
	deleteCalls    int
	deleteIdxCalls int
	lastLanguage   repository.FulltextLanguage
	lastQuery      string
	results        []repository.FulltextSearchResult
}

func (f *fakeFulltextRepo) Upsert(
	ctx context.Context,
	projectKey string,
	indexName string,
	docID string,
	title string,
	contentPlain string,
	metadata map[string]any,
) error {
	f.upsertCalls++
	return nil
}

func (f *fakeFulltextRepo) Delete(ctx context.Context, projectKey string, indexName string, docID string) error {
	f.deleteCalls++
	return nil
}

func (f *fakeFulltextRepo) DeleteByIndex(ctx context.Context, projectKey string, indexName string) error {
	f.deleteIdxCalls++
	return nil
}

func (f *fakeFulltextRepo) Search(
	ctx context.Context,
	projectKey string,
	indexName string,
	language repository.FulltextLanguage,
	queryText string,
	filters map[string]string,
	limit int,
	offset int,
	highlight bool,
	sortBy string,
) ([]repository.FulltextSearchResult, error) {
	f.lastLanguage = language
	f.lastQuery = queryText
	return f.results, nil
}

func (f *fakeFulltextRepo) FuzzySearch(
	ctx context.Context,
	projectKey string,
	indexName string,
	queryText string,
	minSimilarity float64,
	limit int,
	offset int,
) ([]repository.FulltextSearchResult, error) {
	f.lastQuery = queryText
	return f.results, nil
}

func TestExtractDocumentText_Tiptap(t *testing.T) {
	doc := &domain.Document{
		Meta: domain.DocumentMeta{Title: "文档功能"},
		Body: domain.DocumentBody{
			Type: "tiptap",
			Content: map[string]any{
				"content": map[string]any{
					"type": "doc",
					"content": []any{
						map[string]any{
							"type": "paragraph",
							"content": []any{
								map[string]any{"type": "text", "text": "说明"},
							},
						},
						map[string]any{
							"type": "codeBlock",
							"content": []any{
								map[string]any{"type": "text", "text": "代码块"},
							},
						},
						map[string]any{
							"type": "bulletList",
							"content": []any{
								map[string]any{
									"type": "listItem",
									"content": []any{
										map[string]any{
											"type": "paragraph",
											"content": []any{
												map[string]any{"type": "text", "text": "List1"},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}

	text := extractDocumentText(doc)
	if !strings.HasPrefix(text, "文档功能") {
		t.Fatalf("expected title prefix, got %q", text)
	}
	for _, needle := range []string{"说明", "代码块", "List1"} {
		if !strings.Contains(text, needle) {
			t.Fatalf("expected text to contain %q, got %q", needle, text)
		}
	}
	if strings.Index(text, "说明") > strings.Index(text, "代码块") {
		t.Fatalf("expected order: 说明 before 代码块, got %q", text)
	}
}

func TestBuildFullRebuild(t *testing.T) {
	repo := &fakeFulltextRepo{}
	svc := NewService(repository.Repository{KnowledgeFulltext: repo})
	index := service.IndexSpec{Kind: service.IndexFulltext, Name: "default"}
	req := service.IndexBuildRequest{
		ProjectKey:  "proj",
		Index:       index,
		FullRebuild: true,
		Docs: []*domain.Document{
			{Meta: domain.DocumentMeta{ID: "doc-1", Title: "T1"}},
			{Meta: domain.DocumentMeta{ID: "doc-2", Title: "T2"}},
		},
	}
	if err := svc.Build(context.Background(), req); err != nil {
		t.Fatalf("build failed: %v", err)
	}
	if repo.deleteIdxCalls != 1 {
		t.Fatalf("expected delete index once, got %d", repo.deleteIdxCalls)
	}
	if repo.upsertCalls != 2 {
		t.Fatalf("expected upsert twice, got %d", repo.upsertCalls)
	}
}

func TestSearchLanguageDetect(t *testing.T) {
	repo := &fakeFulltextRepo{}
	svc := NewService(repository.Repository{KnowledgeFulltext: repo})
	index := service.IndexSpec{Kind: service.IndexFulltext, Name: "default"}

	_, err := svc.Search(context.Background(), "proj", index, service.SearchQuery{Text: "hello"})
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if repo.lastLanguage != repository.FulltextEnglish {
		t.Fatalf("expected english, got %s", repo.lastLanguage)
	}

	_, err = svc.Search(context.Background(), "proj", index, service.SearchQuery{Text: "你好"})
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if repo.lastLanguage != repository.FulltextChinese {
		t.Fatalf("expected chinese, got %s", repo.lastLanguage)
	}
}
