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
	mu       sync.RWMutex
	idToData map[string]CachedDoc
}

func NewIndexManager() *IndexManager {
	return &IndexManager{
		idToData: make(map[string]CachedDoc),
	}
}

func (idx *IndexManager) Rebuild(root string) {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	idx.idToData = make(map[string]CachedDoc)

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
			idx.idToData[partial.Meta.ID] = CachedDoc{
				Path:     relPath,
				Title:    partial.Meta.Title,
				ParentID: partial.Meta.ParentID,
			}
		}

		return nil
	})
}

func (idx *IndexManager) Get(id string) (CachedDoc, bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	val, ok := idx.idToData[id]
	return val, ok
}

func (idx *IndexManager) Update(id string, data CachedDoc) {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	idx.idToData[id] = data
}

func (idx *IndexManager) Remove(id string) {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	delete(idx.idToData, id)
}

func (idx *IndexManager) FindIDByPath(path string) (string, bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	for id, data := range idx.idToData {
		if data.Path == path {
			return id, true
		}
	}
	return "", false
}
