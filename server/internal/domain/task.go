package domain

import "time"

type TaskStatus string

const (
	TaskStatusPending  TaskStatus = "pending"
	TaskStatusRunning  TaskStatus = "running"
	TaskStatusSuccess  TaskStatus = "success"
	TaskStatusFailed   TaskStatus = "failed"
	TaskStatusCanceled TaskStatus = "canceled"
)

const (
	TaskTypeRAGRebuildProject = "rag_rebuild_project"
)

// Task represents a unit of asynchronous work stored in the database.
// It is derived workflow state and can be retried or rebuilt without
// affecting Git as a source of truth.
type Task struct {
	ID             string
	Type           string
	ProjectID      string
	Payload        map[string]interface{}
	Status         TaskStatus
	Attempts       int
	MaxAttempts    int
	ScheduledAt    *time.Time
	StartedAt      *time.Time
	FinishedAt     *time.Time
	LastHeartbeat  *time.Time
	LockOwner      string
	LockExpiresAt  *time.Time
	Result         map[string]interface{}
	ErrorMessage   string
	CallbackURL    string
	CallbackSecret string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}
