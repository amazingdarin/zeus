package ragindex

import (
	"context"
	"sort"
	"strings"
	"sync"

	domainrag "zeus/internal/domain/rag"
)

// MemoryIndex is a Phase 1 in-memory index implementation.
// It is derived and can be rebuilt at any time.
type MemoryIndex struct {
	mu    sync.RWMutex
	units map[string]map[string][]IndexedUnit
}

func NewMemoryIndex() *MemoryIndex {
	return &MemoryIndex{units: make(map[string]map[string][]IndexedUnit)}
}

func (m *MemoryIndex) Upsert(ctx context.Context, items []IndexedUnit) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, item := range items {
		projectID := strings.TrimSpace(item.Unit.ProjectID)
		docID := strings.TrimSpace(item.Unit.DocID)
		if projectID == "" || docID == "" {
			continue
		}
		project := m.units[projectID]
		if project == nil {
			project = make(map[string][]IndexedUnit)
			m.units[projectID] = project
		}
		project[docID] = append(project[docID], item)
	}
	return nil
}

func (m *MemoryIndex) DeleteByProject(ctx context.Context, projectID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.units, strings.TrimSpace(projectID))
	return nil
}

func (m *MemoryIndex) DeleteByDoc(ctx context.Context, projectID, docID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	project := m.units[strings.TrimSpace(projectID)]
	if project == nil {
		return nil
	}
	delete(project, strings.TrimSpace(docID))
	if len(project) == 0 {
		delete(m.units, strings.TrimSpace(projectID))
	}
	return nil
}

func (m *MemoryIndex) Search(
	ctx context.Context,
	projectID string,
	queryVec []float32,
	topK int,
	filter IndexFilter,
) ([]IndexHit, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	project := m.units[strings.TrimSpace(projectID)]
	if project == nil {
		return []IndexHit{}, nil
	}
	candidates := make([]IndexHit, 0)
	for docID, units := range project {
		if filter.DocIDPrefix != "" && !strings.HasPrefix(docID, filter.DocIDPrefix) {
			continue
		}
		for _, item := range units {
			if !pathMatches(filter.PathPrefix, item.Unit.Path) {
				continue
			}
			score := dot(queryVec, item.Vector)
			candidates = append(candidates, IndexHit{Unit: item.Unit, Score: score})
		}
	}
	if len(candidates) == 0 {
		return []IndexHit{}, nil
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].Score > candidates[j].Score
	})
	if topK > 0 && len(candidates) > topK {
		candidates = candidates[:topK]
	}
	return candidates, nil
}

func pathMatches(prefix []string, path []string) bool {
	if len(prefix) == 0 {
		return true
	}
	if len(path) < len(prefix) {
		return false
	}
	for i := range prefix {
		if prefix[i] != path[i] {
			return false
		}
	}
	return true
}

func dot(a, b []float32) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	length := len(a)
	if len(b) < length {
		length = len(b)
	}
	var sum float64
	for i := 0; i < length; i++ {
		sum += float64(a[i] * b[i])
	}
	return sum
}

var _ KnowledgeIndex = (*MemoryIndex)(nil)
var _ = domainrag.RAGUnit{}
