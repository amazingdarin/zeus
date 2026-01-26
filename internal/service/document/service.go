package document

import (
	"path/filepath"
	"time"

	"zeus/internal/domain/docstore"
	"zeus/internal/service"
)

type Service struct {
	repoRoot string
	index    *IndexManager
	hooks    docstore.Hooks
}

var _ service.DocumentService = (*Service)(nil)

func (s *Service) projectRoot(projectKey string) string {
	return filepath.Join(s.repoRoot, projectKey)
}

func NewService(rootDir string) service.DocumentService {
	svc := &Service{
		repoRoot: rootDir,
		index:    NewIndexManager(),
	}
	return svc
}

func (s *Service) RegisterHooks(hooks docstore.Hooks) {
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
