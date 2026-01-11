package rag

import (
	"context"
	"time"

	domainrag "zeus/internal/domain/rag"
)

type ContextAssembler interface {
	Assemble(ctx context.Context, query domainrag.RAGQuery, matches []domainrag.RAGMatch) (domainrag.RAGContextBundle, error)
}

// SimpleAssembler builds context bundles directly from the top matches.
// It keeps the assembly logic isolated to allow future enhancements.
type SimpleAssembler struct{}

func (a SimpleAssembler) Assemble(
	ctx context.Context,
	query domainrag.RAGQuery,
	matches []domainrag.RAGMatch,
) (domainrag.RAGContextBundle, error) {
	items := make([]domainrag.RAGContextItem, 0, len(matches))
	seen := make(map[string]struct{})
	for _, match := range matches {
		if match.Unit.UnitID == "" {
			continue
		}
		if _, ok := seen[match.Unit.UnitID]; ok {
			continue
		}
		seen[match.Unit.UnitID] = struct{}{}
		items = append(items, domainrag.RAGContextItem{
			UnitID:  match.Unit.UnitID,
			DocID:   match.Unit.DocID,
			Path:    match.Unit.Path,
			Content: match.Unit.Content,
			Source:  match.Unit.Source,
		})
	}
	bundle := domainrag.RAGContextBundle{
		Query: query,
		Items: items,
		Debug: map[string]any{
			"top_k":    query.TopK,
			"item_cnt": len(items),
			"ts":       time.Now().Format(time.RFC3339Nano),
		},
	}
	return bundle, nil
}
