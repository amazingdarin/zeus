package domain

import "time"

// KnowledgeChangeProposal represents a suggested document change.
// It is derived data and must be explicitly applied to update Git.
type KnowledgeChangeProposal struct {
	ID        string
	ProjectID string
	DocID     string
	Status    KnowledgeChangeStatus

	// Meta and Content describe the proposed updates. Nil means no change.
	Meta    *DocumentMeta
	Content *DocumentContent

	CreatedAt time.Time
	UpdatedAt time.Time
}

type KnowledgeChangeStatus string

const (
	KnowledgeChangePending  KnowledgeChangeStatus = "pending"
	KnowledgeChangeApplied  KnowledgeChangeStatus = "applied"
	KnowledgeChangeRejected KnowledgeChangeStatus = "rejected"
)
