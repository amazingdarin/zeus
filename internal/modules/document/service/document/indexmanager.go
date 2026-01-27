package document

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"zeus/internal/domain/docstore"
)

// --- Index Manager ---

type IndexManager struct {
	mu   sync.RWMutex
	data map[string]map[string]CachedDoc
}

func NewIndexManager() *IndexManager {
	return &IndexManager{
		data: make(map[string]map[string]CachedDoc),
	}
}

// Ensure initializes the project index if it has not been built yet.
func (idx *IndexManager) Ensure(projectKey, root string) {
	idx.mu.RLock()
	_, ok := idx.data[projectKey]
	idx.mu.RUnlock()
	if ok {
		return
	}
	idx.RebuildProject(projectKey, root)
}

// RebuildProject rebuilds the in-memory index by scanning project files.
func (idx *IndexManager) RebuildProject(projectKey, root string) {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	idx.data[projectKey] = make(map[string]CachedDoc)
	projectData := idx.data[projectKey]

	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		// Only process supported files
		if !strings.HasSuffix(d.Name(), ".json") && !strings.HasSuffix(d.Name(), ".md") {
			return nil
		}

		// Read file to extract ID and Meta
		// Optimization: In real impl, read only first 4KB to parse meta
		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer f.Close()

		// Simple JSON parser for "meta" field
		// This assumes the file is JSON and has a "meta" field at the top level
		// For MD, we would need to parse frontmatter
		var partial struct {
			Meta docstore.DocumentMeta `json:"meta"`
		}

		// Read fully for now to be safe, optimize later
		decoder := json.NewDecoder(f)
		if err := decoder.Decode(&partial); err == nil && partial.Meta.ID != "" {
			relPath, _ := filepath.Rel(root, path)
			projectData[partial.Meta.ID] = CachedDoc{
				Path:     relPath,
				Title:    partial.Meta.Title,
				ParentID: partial.Meta.ParentID,
			}
		}

		return nil
	})
}

// Get returns cached metadata for a document ID.
func (idx *IndexManager) Get(projectKey, id string) (CachedDoc, bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	projectData, ok := idx.data[projectKey]
	if !ok {
		return CachedDoc{}, false
	}
	val, ok := projectData[id]
	return val, ok
}

// Update stores cached metadata for a document ID.
func (idx *IndexManager) Update(projectKey, id string, data CachedDoc) {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	if _, ok := idx.data[projectKey]; !ok {
		idx.data[projectKey] = make(map[string]CachedDoc)
	}
	idx.data[projectKey][id] = data
}

// Remove deletes cached metadata for a document ID.
func (idx *IndexManager) Remove(projectKey, id string) {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	if _, ok := idx.data[projectKey]; !ok {
		return
	}
	delete(idx.data[projectKey], id)
}

// FindIDByPath returns the document ID for a given relative path.
func (idx *IndexManager) FindIDByPath(projectKey, path string) (string, bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	projectData, ok := idx.data[projectKey]
	if !ok {
		return "", false
	}
	for id, data := range projectData {
		if data.Path == path {
			return id, true
		}
	}
	return "", false
}
