package service

import (
	"context"

	"zeus/internal/api/types"
)

type RawDocumentService interface {
	List(
		ctx context.Context,
		batchID string,
		limit int,
		offset int,
	) (docs []types.RawDocumentDTO, total int, err error)

	Get(
		ctx context.Context,
		docID string,
	) (*types.RawDocumentDTO, error)
}
