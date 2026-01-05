package service

import (
	"context"

	"zeus/internal/domain"
)

type SearchService interface {
	Search(ctx context.Context, projectKey, query string) ([]domain.SearchResult, error)
	Rebuild(ctx context.Context, projectKey string) error
}
