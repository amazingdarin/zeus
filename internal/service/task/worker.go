package task

import (
	"context"
	"fmt"
	"strings"
	"time"

	log "github.com/sirupsen/logrus"

	"zeus/internal/domain"
	"zeus/internal/infra/taskcallback"
	"zeus/internal/repository"
)

type Handler interface {
	Type() string
	Handle(ctx context.Context, task domain.Task) (map[string]interface{}, error)
}

type Worker struct {
	repo         repository.TaskRepository
	callback     taskcallback.Sender
	handlers     map[string]Handler
	workerID     string
	pollInterval time.Duration
	lockDuration time.Duration
}

func NewWorker(
	repo repository.TaskRepository,
	handlers []Handler,
	callback taskcallback.Sender,
	workerID string,
	pollInterval time.Duration,
	lockDuration time.Duration,
) *Worker {
	registry := make(map[string]Handler)
	for _, handler := range handlers {
		if handler == nil {
			continue
		}
		registry[handler.Type()] = handler
	}
	if pollInterval <= 0 {
		pollInterval = 3 * time.Second
	}
	if lockDuration <= 0 {
		lockDuration = 2 * time.Minute
	}
	return &Worker{
		repo:         repo,
		callback:     callback,
		handlers:     registry,
		workerID:     workerID,
		pollInterval: pollInterval,
		lockDuration: lockDuration,
	}
}

func (w *Worker) Start(ctx context.Context) {
	if w.repo == nil {
		log.WithContext(ctx).Error("task worker: repository is required")
		return
	}
	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.WithContext(ctx).Info("task worker stopped")
			return
		case <-ticker.C:
			w.poll(ctx)
		}
	}
}

func (w *Worker) poll(ctx context.Context) {
	tasks, err := w.repo.ClaimPending(ctx, w.workerID, 4, w.lockDuration)
	if err != nil {
		log.WithContext(ctx).WithField("error", err).Error("task worker claim failed")
		return
	}
	for _, task := range tasks {
		if task == nil {
			continue
		}
		w.process(ctx, task)
	}
}

func (w *Worker) process(ctx context.Context, task *domain.Task) {
	if task == nil {
		return
	}
	handler := w.handlers[task.Type]
	if handler == nil {
		err := fmt.Errorf("no handler for task type %s", task.Type)
		w.failTask(ctx, task, err)
		return
	}
	log.WithContext(ctx).WithFields(log.Fields{
		"task_id":    task.ID,
		"task_type":  task.Type,
		"project_id": task.ProjectID,
		"attempts":   task.Attempts,
	}).Info("task start")
	result, err := handler.Handle(ctx, *task)
	if err != nil {
		w.failTask(ctx, task, err)
		return
	}
	if err := w.repo.Complete(ctx, task.ID, domain.TaskStatusSuccess, result, ""); err != nil {
		log.WithContext(ctx).WithFields(log.Fields{
			"task_id": task.ID,
			"error":   err,
		}).Error("task complete failed")
	}
	log.WithContext(ctx).WithFields(log.Fields{
		"task_id":    task.ID,
		"task_type":  task.Type,
		"project_id": task.ProjectID,
	}).Info("task success")
	w.sendCallback(ctx, task, string(domain.TaskStatusSuccess), result, "")
}

func (w *Worker) failTask(ctx context.Context, task *domain.Task, err error) {
	if task == nil {
		return
	}
	attempts := task.Attempts
	maxAttempts := task.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = 3
	}
	if attempts < maxAttempts {
		delay := time.Duration(attempts) * 30 * time.Second
		if delay <= 0 {
			delay = 30 * time.Second
		}
		if rescheduleErr := w.repo.Reschedule(ctx, task.ID, delay); rescheduleErr != nil {
			log.WithContext(ctx).WithFields(log.Fields{
				"task_id": task.ID,
				"error":   rescheduleErr,
			}).Error("task reschedule failed")
		}
		log.WithContext(ctx).WithFields(log.Fields{
			"task_id":      task.ID,
			"task_type":    task.Type,
			"project_id":   task.ProjectID,
			"attempts":     attempts,
			"max_attempts": maxAttempts,
			"error":        err,
		}).Warn("task failed, scheduled retry")
		return
	}
	if completeErr := w.repo.Complete(ctx, task.ID, domain.TaskStatusFailed, nil, err.Error()); completeErr != nil {
		log.WithContext(ctx).WithFields(log.Fields{
			"task_id": task.ID,
			"error":   completeErr,
		}).Error("task failed completion update error")
	}
	log.WithContext(ctx).WithFields(log.Fields{
		"task_id":    task.ID,
		"task_type":  task.Type,
		"project_id": task.ProjectID,
		"error":      err,
	}).Error("task failed")
	w.sendCallback(ctx, task, string(domain.TaskStatusFailed), nil, err.Error())
}

func (w *Worker) sendCallback(
	ctx context.Context,
	task *domain.Task,
	status string,
	result map[string]interface{},
	errorMessage string,
) {
	if task == nil || w.callback == nil || strings.TrimSpace(task.CallbackURL) == "" {
		return
	}
	if err := w.callback.Send(ctx, *task, status, result, errorMessage); err != nil {
		log.WithContext(ctx).WithFields(log.Fields{
			"task_id": task.ID,
			"error":   err,
		}).Warn("task callback failed")
	}
}
