package search

import (
	"context"
	"fmt"
	"strings"

	"zeus/internal/domain"
	"zeus/internal/infra/searchindex"
	"zeus/internal/service"
)

type Service struct {
	builder *searchindex.IndexBuilder
}

func NewService(builder *searchindex.IndexBuilder) *Service {
	return &Service{builder: builder}
}

func (s *Service) Search(
	ctx context.Context,
	projectKey string,
	query string,
) ([]domain.SearchResult, error) {
	if s == nil || s.builder == nil {
		return nil, fmt.Errorf("search service not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return nil, fmt.Errorf("project key is required")
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("query is required")
	}
	if err := s.builder.Ensure(ctx, projectKey); err != nil {
		return nil, err
	}
	return s.builder.Search(ctx, projectKey, query)
}

func (s *Service) Rebuild(ctx context.Context, projectKey string) error {
	if s == nil || s.builder == nil {
		return fmt.Errorf("search service not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return fmt.Errorf("project key is required")
	}
	return s.builder.Build(ctx, projectKey)
}

var _ service.SearchService = (*Service)(nil)
