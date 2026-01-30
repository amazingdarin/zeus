package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"zeus/internal/domain"
	"zeus/internal/repository"
	"zeus/internal/repository/postgres/mapper"
	"zeus/internal/repository/postgres/model"

	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type TaskRepository struct {
	db *gorm.DB
}

func NewTaskRepository(db *gorm.DB) *TaskRepository {
	return &TaskRepository{db: db}
}

func (r *TaskRepository) Insert(ctx context.Context, task *domain.Task) error {
	if task == nil {
		return fmt.Errorf("task is nil")
	}
	modelObj := mapper.TaskFromDomain(task)
	if modelObj == nil {
		return fmt.Errorf("task is nil")
	}
	if err := r.db.WithContext(ctx).Create(modelObj).Error; err != nil {
		return fmt.Errorf("insert task: %w", err)
	}
	return nil
}

func (r *TaskRepository) FindByID(ctx context.Context, id string) (*domain.Task, error) {
	var modelObj model.Task
	if err := r.db.WithContext(ctx).First(&modelObj, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("find task: %w", err)
	}
	return mapper.TaskToDomain(&modelObj), nil
}

func (r *TaskRepository) ClaimPending(
	ctx context.Context,
	workerID string,
	limit int,
	lockDuration time.Duration,
) ([]*domain.Task, error) {
	if limit <= 0 {
		limit = 1
	}
	now := time.Now().UTC()
	lockExpiresAt := now.Add(lockDuration)
	tasks := make([]model.Task, 0)

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		query := tx.Model(&model.Task{}).
			Where("status = ?", domain.TaskStatusPending).
			Where("(scheduled_at IS NULL OR scheduled_at <= ?)", now).
			Where("(lock_expires_at IS NULL OR lock_expires_at < ?)", now).
			Order("scheduled_at ASC NULLS FIRST, created_at ASC").
			Limit(limit).
			Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})

		if err := query.Find(&tasks).Error; err != nil {
			return err
		}
		if len(tasks) == 0 {
			return nil
		}
		ids := make([]string, 0, len(tasks))
		for _, task := range tasks {
			ids = append(ids, task.ID)
		}
		updates := map[string]interface{}{
			"status":          string(domain.TaskStatusRunning),
			"lock_owner":      workerID,
			"lock_expires_at": lockExpiresAt,
			"last_heartbeat":  now,
			"attempts":        gorm.Expr("attempts + 1"),
			"updated_at":      now,
			"started_at":      gorm.Expr("COALESCE(started_at, ?)", now),
		}
		return tx.Model(&model.Task{}).Where("id IN ?", ids).Updates(updates).Error
	})
	if err != nil {
		return nil, fmt.Errorf("claim pending tasks: %w", err)
	}
	if len(tasks) == 0 {
		return []*domain.Task{}, nil
	}
	claimed := make([]*domain.Task, 0, len(tasks))
	for i := range tasks {
		task := tasks[i]
		task.Status = string(domain.TaskStatusRunning)
		task.LockOwner = workerID
		task.LockExpiresAt = &lockExpiresAt
		task.LastHeartbeat = &now
		if task.StartedAt == nil {
			task.StartedAt = &now
		}
		task.Attempts++
		claimed = append(claimed, mapper.TaskToDomain(&task))
	}
	return claimed, nil
}

func (r *TaskRepository) Complete(
	ctx context.Context,
	id string,
	status domain.TaskStatus,
	result map[string]interface{},
	errorMessage string,
) error {
	now := time.Now().UTC()
	updates := map[string]interface{}{
		"status":          string(status),
		"result":          encodeJSONMap(result),
		"error_message":   errorMessage,
		"finished_at":     now,
		"lock_owner":      "",
		"lock_expires_at": nil,
		"updated_at":      now,
	}
	if err := r.db.WithContext(ctx).Model(&model.Task{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		return fmt.Errorf("complete task: %w", err)
	}
	return nil
}

func (r *TaskRepository) Reschedule(ctx context.Context, id string, delay time.Duration) error {
	now := time.Now().UTC()
	scheduled := now.Add(delay)
	updates := map[string]interface{}{
		"status":          string(domain.TaskStatusPending),
		"scheduled_at":    scheduled,
		"lock_owner":      "",
		"lock_expires_at": nil,
		"updated_at":      now,
	}
	if err := r.db.WithContext(ctx).Model(&model.Task{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		return fmt.Errorf("reschedule task: %w", err)
	}
	return nil
}

func encodeJSONMap(value map[string]interface{}) datatypes.JSON {
	if value == nil {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return datatypes.JSON(data)
}

var _ repository.TaskRepository = (*TaskRepository)(nil)
