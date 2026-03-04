package model

import "time"

type CodeRun struct {
	ID            string     `gorm:"column:id;primaryKey"`
	RunID         string     `gorm:"column:run_id;not null;uniqueIndex"`
	RequestID     string     `gorm:"column:request_id;not null"`
	OwnerType     string     `gorm:"column:owner_type;not null"`
	OwnerID       string     `gorm:"column:owner_id;not null"`
	ProjectKey    string     `gorm:"column:project_key;not null"`
	DocID         string     `gorm:"column:doc_id;not null"`
	BlockID       string     `gorm:"column:block_id;not null"`
	UserID        string     `gorm:"column:user_id;not null"`
	Language      string     `gorm:"column:language;not null"`
	ImageRef      string     `gorm:"column:image_ref;not null"`
	Status        string     `gorm:"column:status;not null"`
	Stdout        string     `gorm:"column:stdout"`
	Stderr        string     `gorm:"column:stderr"`
	Truncated     bool       `gorm:"column:truncated;not null"`
	TimedOut      bool       `gorm:"column:timed_out;not null"`
	ExitCode      int        `gorm:"column:exit_code;not null"`
	DurationMs    int64      `gorm:"column:duration_ms;not null"`
	CPULimitMilli int        `gorm:"column:cpu_limit_milli;not null"`
	MemoryLimitMB int        `gorm:"column:memory_limit_mb;not null"`
	TimeoutMs     int        `gorm:"column:timeout_ms;not null"`
	CodeSHA256    string     `gorm:"column:code_sha256;not null"`
	CreatedAt     time.Time  `gorm:"column:created_at;autoCreateTime"`
	StartedAt     *time.Time `gorm:"column:started_at"`
	FinishedAt    *time.Time `gorm:"column:finished_at"`
}

func (CodeRun) TableName() string {
	return "document_code_runs"
}
