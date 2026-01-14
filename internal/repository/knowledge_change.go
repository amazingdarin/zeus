package repository

import (
	"context"
	"errors"

	"zeus/internal/domain"
)

var ErrKnowledgeChangeProposalNotFound = errors.New("change proposal not found")

type KnowledgeChangeProposalRepository interface {
	Create(ctx context.Context, proposal *domain.KnowledgeChangeProposal) error
	Get(ctx context.Context, proposalID string) (*domain.KnowledgeChangeProposal, bool, error)
	UpdateStatus(ctx context.Context, proposalID string, status domain.KnowledgeChangeStatus) error
}
