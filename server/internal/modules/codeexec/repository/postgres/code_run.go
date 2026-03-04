package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"

	codeexecrepo "zeus/internal/modules/codeexec/repository"
	"zeus/internal/modules/codeexec/repository/postgres/model"
)

type CodeRunRepository struct {
	db *gorm.DB
}

func NewCodeRunRepository(db *gorm.DB) *CodeRunRepository {
	return &CodeRunRepository{db: db}
}

func (r *CodeRunRepository) Insert(ctx context.Context, run *codeexecrepo.CodeRun) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("repository not initialized")
	}
	if run == nil {
		return fmt.Errorf("code run is nil")
	}
	modelObj := toModel(run)
	if modelObj.ID == "" {
		modelObj.ID = uuid.NewString()
	}
	if modelObj.RunID == "" {
		return fmt.Errorf("run_id is required")
	}
	if err := r.db.WithContext(ctx).Create(modelObj).Error; err != nil {
		return fmt.Errorf("insert code run: %w", err)
	}
	run.ID = modelObj.ID
	run.CreatedAt = modelObj.CreatedAt
	return nil
}

func (r *CodeRunRepository) FindByRunID(ctx context.Context, runID string) (*codeexecrepo.CodeRun, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("repository not initialized")
	}
	normalized := stringsTrim(runID)
	if normalized == "" {
		return nil, fmt.Errorf("run_id is required")
	}
	var modelObj model.CodeRun
	if err := r.db.WithContext(ctx).First(&modelObj, "run_id = ?", normalized).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("find code run: %w", err)
	}
	return toEntity(&modelObj), nil
}

func (r *CodeRunRepository) ListByDocument(
	ctx context.Context,
	filter codeexecrepo.CodeRunListFilter,
) ([]*codeexecrepo.CodeRun, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("repository not initialized")
	}
	if stringsTrim(filter.OwnerType) == "" || stringsTrim(filter.OwnerID) == "" || stringsTrim(filter.ProjectKey) == "" || stringsTrim(filter.DocID) == "" {
		return nil, fmt.Errorf("owner_type, owner_id, project_key and doc_id are required")
	}
	limit := filter.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	query := r.db.WithContext(ctx).Model(&model.CodeRun{}).
		Where("owner_type = ? AND owner_id = ? AND project_key = ? AND doc_id = ?",
			filter.OwnerType, filter.OwnerID, filter.ProjectKey, filter.DocID).
		Order("created_at DESC").
		Limit(limit)
	if stringsTrim(filter.BlockID) != "" {
		query = query.Where("block_id = ?", filter.BlockID)
	}
	var models []model.CodeRun
	if err := query.Find(&models).Error; err != nil {
		return nil, fmt.Errorf("list code runs: %w", err)
	}
	result := make([]*codeexecrepo.CodeRun, 0, len(models))
	for i := range models {
		result = append(result, toEntity(&models[i]))
	}
	return result, nil
}

func toModel(input *codeexecrepo.CodeRun) *model.CodeRun {
	if input == nil {
		return nil
	}
	return &model.CodeRun{
		ID:            input.ID,
		RunID:         input.RunID,
		RequestID:     input.RequestID,
		OwnerType:     input.OwnerType,
		OwnerID:       input.OwnerID,
		ProjectKey:    input.ProjectKey,
		DocID:         input.DocID,
		BlockID:       input.BlockID,
		UserID:        input.UserID,
		Language:      input.Language,
		ImageRef:      input.ImageRef,
		Status:        input.Status,
		Stdout:        input.Stdout,
		Stderr:        input.Stderr,
		Truncated:     input.Truncated,
		TimedOut:      input.TimedOut,
		ExitCode:      input.ExitCode,
		DurationMs:    input.DurationMs,
		CPULimitMilli: input.CPULimitMilli,
		MemoryLimitMB: input.MemoryLimitMB,
		TimeoutMs:     input.TimeoutMs,
		CodeSHA256:    input.CodeSHA256,
		CreatedAt:     input.CreatedAt,
		StartedAt:     input.StartedAt,
		FinishedAt:    input.FinishedAt,
	}
}

func toEntity(input *model.CodeRun) *codeexecrepo.CodeRun {
	if input == nil {
		return nil
	}
	return &codeexecrepo.CodeRun{
		ID:            input.ID,
		RunID:         input.RunID,
		RequestID:     input.RequestID,
		OwnerType:     input.OwnerType,
		OwnerID:       input.OwnerID,
		ProjectKey:    input.ProjectKey,
		DocID:         input.DocID,
		BlockID:       input.BlockID,
		UserID:        input.UserID,
		Language:      input.Language,
		ImageRef:      input.ImageRef,
		Status:        input.Status,
		Stdout:        input.Stdout,
		Stderr:        input.Stderr,
		Truncated:     input.Truncated,
		TimedOut:      input.TimedOut,
		ExitCode:      input.ExitCode,
		DurationMs:    input.DurationMs,
		CPULimitMilli: input.CPULimitMilli,
		MemoryLimitMB: input.MemoryLimitMB,
		TimeoutMs:     input.TimeoutMs,
		CodeSHA256:    input.CodeSHA256,
		CreatedAt:     input.CreatedAt,
		StartedAt:     input.StartedAt,
		FinishedAt:    input.FinishedAt,
	}
}

func stringsTrim(value string) string {
	return strings.TrimSpace(value)
}

var _ codeexecrepo.CodeRunRepository = (*CodeRunRepository)(nil)
