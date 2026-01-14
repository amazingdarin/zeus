package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"zeus/internal/domain"
	"zeus/internal/repository"
	"zeus/internal/repository/postgres/mapper"
	"zeus/internal/repository/postgres/model"

	"gorm.io/gorm"
)

type KnowledgeChangeProposalRepository struct {
	db *gorm.DB
}

func NewKnowledgeChangeProposalRepository(db *gorm.DB) *KnowledgeChangeProposalRepository {
	return &KnowledgeChangeProposalRepository{db: db}
}

func (r *KnowledgeChangeProposalRepository) Create(
	ctx context.Context,
	proposal *domain.KnowledgeChangeProposal,
) error {
	if proposal == nil {
		return fmt.Errorf("proposal is nil")
	}
	modelObj := mapper.KnowledgeChangeProposalFromDomain(proposal)
	if modelObj == nil {
		return fmt.Errorf("proposal is nil")
	}
	if err := r.db.WithContext(ctx).Create(modelObj).Error; err != nil {
		return fmt.Errorf("create knowledge change proposal: %w", err)
	}
	return nil
}

func (r *KnowledgeChangeProposalRepository) Get(
	ctx context.Context,
	proposalID string,
) (*domain.KnowledgeChangeProposal, bool, error) {
	if proposalID == "" {
		return nil, false, fmt.Errorf("proposal id is required")
	}
	var modelObj model.KnowledgeChangeProposal
	err := r.db.WithContext(ctx).First(&modelObj, "id = ?", proposalID).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("get knowledge change proposal: %w", err)
	}
	return mapper.KnowledgeChangeProposalToDomain(&modelObj), true, nil
}

func (r *KnowledgeChangeProposalRepository) UpdateStatus(
	ctx context.Context,
	proposalID string,
	status domain.KnowledgeChangeStatus,
) error {
	if proposalID == "" {
		return fmt.Errorf("proposal id is required")
	}
	if err := r.db.WithContext(ctx).
		Model(&model.KnowledgeChangeProposal{}).
		Where("id = ?", proposalID).
		Updates(map[string]interface{}{
			"status":     string(status),
			"updated_at": time.Now().UTC(),
		}).Error; err != nil {
		return fmt.Errorf("update proposal status: %w", err)
	}
	return nil
}

var _ repository.KnowledgeChangeProposalRepository = (*KnowledgeChangeProposalRepository)(nil)
