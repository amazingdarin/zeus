package document

import (
	"path/filepath"
	"time"

	"zeus/internal/domain"
	"zeus/internal/modules/document/service"
)

type Service struct {
	repoRoot string
	index    *IndexManager
	hooks    domain.Hooks
}

var _ service.DocumentService = (*Service)(nil)

// projectRoot returns the filesystem root for a project.
func (s *Service) projectRoot(projectKey string) string {
	return filepath.Join(s.repoRoot, projectKey)
}

// NewService constructs a document service with a local index cache.
func NewService(repoRoot string) service.DocumentService {
	svc := &Service{
		repoRoot: repoRoot,
		index:    NewIndexManager(),
	}
	return svc
}

// RegisterHooks appends lifecycle hooks for save/delete/move operations.
func (s *Service) RegisterHooks(hooks domain.Hooks) {
	s.hooks.BeforeSave = append(s.hooks.BeforeSave, hooks.BeforeSave...)
	s.hooks.AfterSave = append(s.hooks.AfterSave, hooks.AfterSave...)
	s.hooks.BeforeDelete = append(s.hooks.BeforeDelete, hooks.BeforeDelete...)
	s.hooks.AfterDelete = append(s.hooks.AfterDelete, hooks.AfterDelete...)
	s.hooks.BeforeMove = append(s.hooks.BeforeMove, hooks.BeforeMove...)
	s.hooks.AfterMove = append(s.hooks.AfterMove, hooks.AfterMove...)
}

type CachedDoc struct {
	Path     string
	Title    string
	ParentID string
}

// Helper to get time
func now() time.Time {
	return time.Now()
}
