package repository

import "context"

type FulltextLanguage string

const (
	FulltextEnglish FulltextLanguage = "english"
	FulltextChinese FulltextLanguage = "zhparser"
)

type FulltextSearchResult struct {
	DocID    string
	Score    float64
	Snippet  string
	Metadata map[string]any
}

type KnowledgeFulltextRepository interface {
	Upsert(
		ctx context.Context,
		projectKey string,
		indexName string,
		docID string,
		title string,
		contentPlain string,
		metadata map[string]any,
	) error
	Delete(ctx context.Context, projectKey string, indexName string, docID string) error
	DeleteByIndex(ctx context.Context, projectKey string, indexName string) error
	Search(
		ctx context.Context,
		projectKey string,
		indexName string,
		language FulltextLanguage,
		queryText string,
		filters map[string]string,
		limit int,
		offset int,
		highlight bool,
		sortBy string,
	) ([]FulltextSearchResult, error)
	FuzzySearch(
		ctx context.Context,
		projectKey string,
		indexName string,
		queryText string,
		minSimilarity float64,
		limit int,
		offset int,
	) ([]FulltextSearchResult, error)
}
