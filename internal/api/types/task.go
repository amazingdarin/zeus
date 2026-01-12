package types

type TaskDTO struct {
	ID           string                 `json:"id"`
	Type         string                 `json:"type"`
	ProjectID    string                 `json:"project_id"`
	Status       string                 `json:"status"`
	Attempts     int                    `json:"attempts"`
	MaxAttempts  int                    `json:"max_attempts"`
	ScheduledAt  string                 `json:"scheduled_at"`
	StartedAt    string                 `json:"started_at"`
	FinishedAt   string                 `json:"finished_at"`
	Result       map[string]interface{} `json:"result"`
	ErrorMessage string                 `json:"error_message"`
	CreatedAt    string                 `json:"created_at"`
	UpdatedAt    string                 `json:"updated_at"`
}

type GetTaskResponse struct {
	Code    string  `json:"code"`
	Message string  `json:"message"`
	Data    TaskDTO `json:"data"`
}
