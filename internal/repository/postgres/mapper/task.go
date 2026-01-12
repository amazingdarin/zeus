package mapper

import (
	"zeus/internal/domain"
	"zeus/internal/repository/postgres/model"
)

func TaskFromDomain(task *domain.Task) *model.Task {
	if task == nil {
		return nil
	}
	return &model.Task{
		ID:             task.ID,
		Type:           task.Type,
		ProjectID:      task.ProjectID,
		Payload:        encodeJSON(task.Payload),
		Status:         string(task.Status),
		Attempts:       task.Attempts,
		MaxAttempts:    task.MaxAttempts,
		ScheduledAt:    task.ScheduledAt,
		StartedAt:      task.StartedAt,
		FinishedAt:     task.FinishedAt,
		LastHeartbeat:  task.LastHeartbeat,
		LockOwner:      task.LockOwner,
		LockExpiresAt:  task.LockExpiresAt,
		Result:         encodeJSON(task.Result),
		ErrorMessage:   task.ErrorMessage,
		CallbackURL:    task.CallbackURL,
		CallbackSecret: task.CallbackSecret,
		CreatedAt:      task.CreatedAt,
		UpdatedAt:      task.UpdatedAt,
	}
}

func TaskToDomain(task *model.Task) *domain.Task {
	if task == nil {
		return nil
	}
	return &domain.Task{
		ID:             task.ID,
		Type:           task.Type,
		ProjectID:      task.ProjectID,
		Payload:        decodeJSON(task.Payload),
		Status:         domain.TaskStatus(task.Status),
		Attempts:       task.Attempts,
		MaxAttempts:    task.MaxAttempts,
		ScheduledAt:    task.ScheduledAt,
		StartedAt:      task.StartedAt,
		FinishedAt:     task.FinishedAt,
		LastHeartbeat:  task.LastHeartbeat,
		LockOwner:      task.LockOwner,
		LockExpiresAt:  task.LockExpiresAt,
		Result:         decodeJSON(task.Result),
		ErrorMessage:   task.ErrorMessage,
		CallbackURL:    task.CallbackURL,
		CallbackSecret: task.CallbackSecret,
		CreatedAt:      task.CreatedAt,
		UpdatedAt:      task.UpdatedAt,
	}
}
