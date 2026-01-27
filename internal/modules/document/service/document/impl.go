package document

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"zeus/internal/domain/docstore"
)

var (
	ErrNotFound      = errors.New("document not found")
	ErrBlockNotFound = errors.New("block not found")
)

func (s *Service) Get(ctx context.Context, projectKey, docID string) (*docstore.Document, error) {
	s.index.Ensure(projectKey, s.projectRoot(projectKey))
	cache, ok := s.index.Get(projectKey, docID)
	if !ok {
		return nil, ErrNotFound
	}

	fullPath := filepath.Join(s.projectRoot(projectKey), cache.Path)
	data, err := os.ReadFile(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			s.index.Remove(projectKey, docID)
			return nil, ErrNotFound
		}
		return nil, err
	}

	var doc docstore.Document
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("failed to parse doc: %w", err)
	}
	return &doc, nil
}

func (s *Service) Save(ctx context.Context, projectKey string, doc *docstore.Document) error {
	s.index.Ensure(projectKey, s.projectRoot(projectKey))
	hookCtx := docstore.HookContext{ProjectID: projectKey}
	for _, hook := range s.hooks.BeforeSave {
		if err := hook(hookCtx, doc); err != nil {
			return err
		}
	}

	cache, exists := s.index.Get(projectKey, doc.Meta.ID)

	var targetDir string
	if exists {
		currentPath := filepath.Join(s.projectRoot(projectKey), cache.Path)
		targetDir = filepath.Dir(currentPath)
	} else {
		if doc.Meta.ParentID != "" && doc.Meta.ParentID != "root" {
			parentCache, ok := s.index.Get(projectKey, doc.Meta.ParentID)
			if !ok {
				return errors.New("parent document not found")
			}
			parentPath := filepath.Join(s.projectRoot(projectKey), parentCache.Path)
			ext := filepath.Ext(parentPath)
			targetDir = parentPath[:len(parentPath)-len(ext)]
		} else {
			targetDir = filepath.Join(s.projectRoot(projectKey), "docs")
		}
	}

	if doc.Meta.Slug == "" {
		doc.Meta.Slug = normalizeSlug(doc.Meta.Title)
		if doc.Meta.Slug == "" {
			doc.Meta.Slug = strings.TrimSpace(doc.Meta.ID)
		}
	}

	var finalSlug string
	if exists && cache.Path != "" {
		currentSlug := strings.TrimSuffix(filepath.Base(cache.Path), filepath.Ext(cache.Path))
		if currentSlug == doc.Meta.Slug {
			finalSlug = currentSlug
		} else {
			finalSlug = s.ensureUniqueSlug(targetDir, doc.Meta.Slug, doc.Meta.ID)
		}
	} else {
		finalSlug = s.ensureUniqueSlug(targetDir, doc.Meta.Slug, doc.Meta.ID)
	}
	doc.Meta.Slug = finalSlug

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return err
	}
	filename := finalSlug + ".json"
	fullPath := filepath.Join(targetDir, filename)

	if exists {
		oldFullPath := filepath.Join(s.projectRoot(projectKey), cache.Path)
		if oldFullPath != fullPath {
			if err := s.renameFileAndDir(oldFullPath, fullPath); err != nil {
				return err
			}
			oldDir := filepath.Dir(oldFullPath)
			if oldDir != targetDir {
				s.removeFromIndexFile(projectKey, oldDir, doc.Meta.ID)
			}
		}
	}
	s.addToIndexFile(projectKey, targetDir, doc.Meta.ID)

	doc.Meta.Path, _ = filepath.Rel(s.projectRoot(projectKey), fullPath)
	doc.Meta.UpdatedAt = now()
	if doc.Meta.CreatedAt.IsZero() {
		doc.Meta.CreatedAt = now()
	}

	bytes, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(fullPath, bytes, 0644); err != nil {
		return err
	}

	relPath, _ := filepath.Rel(s.projectRoot(projectKey), fullPath)
	s.index.Update(projectKey, doc.Meta.ID, CachedDoc{
		Path:     relPath,
		Title:    doc.Meta.Title,
		ParentID: doc.Meta.ParentID,
	})

	for _, hook := range s.hooks.AfterSave {
		if err := hook(hookCtx, doc); err != nil {
			return err
		}
	}

	return nil
}

func (s *Service) Delete(ctx context.Context, projectKey, docID string) error {
	s.index.Ensure(projectKey, s.projectRoot(projectKey))
	hookCtx := docstore.HookContext{ProjectID: projectKey}
	for _, hook := range s.hooks.BeforeDelete {
		if err := hook(hookCtx, docID); err != nil {
			return err
		}
	}

	cache, ok := s.index.Get(projectKey, docID)
	if !ok {
		return ErrNotFound
	}

	fullPath := filepath.Join(s.projectRoot(projectKey), cache.Path)

	if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
		return err
	}

	ext := filepath.Ext(fullPath)
	companionDir := fullPath[:len(fullPath)-len(ext)]
	_ = os.RemoveAll(companionDir)

	parentDir := filepath.Dir(fullPath)
	s.removeFromIndexFile(projectKey, parentDir, docID)

	s.index.Remove(projectKey, docID)

	for _, hook := range s.hooks.AfterDelete {
		if err := hook(hookCtx, docID); err != nil {
			return err
		}
	}

	return nil
}

func (s *Service) Move(ctx context.Context, projectKey, docID, targetParentID, beforeDocID, afterDocID string) error {
	s.index.Ensure(projectKey, s.projectRoot(projectKey))
	hookCtx := docstore.HookContext{ProjectID: projectKey}
	for _, hook := range s.hooks.BeforeMove {
		if err := hook(hookCtx, docID, targetParentID); err != nil {
			return err
		}
	}

	cache, ok := s.index.Get(projectKey, docID)
	if !ok {
		return ErrNotFound
	}
	oldPath := filepath.Join(s.projectRoot(projectKey), cache.Path)

	var targetDir string
	if targetParentID == "" || targetParentID == "root" {
		targetDir = filepath.Join(s.projectRoot(projectKey), "docs")
	} else {
		pCache, ok := s.index.Get(projectKey, targetParentID)
		if !ok {
			return errors.New("target parent not found")
		}
		pPath := filepath.Join(s.projectRoot(projectKey), pCache.Path)
		targetDir = pPath[:len(pPath)-len(filepath.Ext(pPath))]
	}

	oldDir := filepath.Dir(oldPath)
	newPath := oldPath
	if oldDir != targetDir {
		if err := os.MkdirAll(targetDir, 0755); err != nil {
			return err
		}
		filename := filepath.Base(oldPath)
		slug := strings.TrimSuffix(filename, filepath.Ext(filename))
		newSlug := s.ensureUniqueSlug(targetDir, slug, docID)
		filename = newSlug + filepath.Ext(filename)

		newPath = filepath.Join(targetDir, filename)
		if err := s.renameFileAndDir(oldPath, newPath); err != nil {
			return err
		}

		relPath, _ := filepath.Rel(s.projectRoot(projectKey), newPath)
		s.index.Update(projectKey, docID, CachedDoc{
			Path:     relPath,
			Title:    cache.Title,
			ParentID: targetParentID,
		})

		data, err := os.ReadFile(newPath)
		if err != nil {
			return err
		}
		var doc docstore.Document
		if err := json.Unmarshal(data, &doc); err != nil {
			return err
		}
		doc.Meta.ParentID = targetParentID
		doc.Meta.Path = relPath
		doc.Meta.UpdatedAt = now()

		bytes, err := json.MarshalIndent(doc, "", "  ")
		if err != nil {
			return err
		}
		if err := os.WriteFile(newPath, bytes, 0644); err != nil {
			return err
		}
	}

	if oldDir != targetDir {
		if err := s.reorderIndexFile(projectKey, oldDir, docID, "", "", false); err != nil {
			return err
		}
	}
	if err := s.reorderIndexFile(projectKey, targetDir, docID, beforeDocID, afterDocID, true); err != nil {
		return err
	}

	for _, hook := range s.hooks.AfterMove {
		if err := hook(hookCtx, docID, targetParentID); err != nil {
			return err
		}
	}

	return nil
}

func (s *Service) GetChildren(ctx context.Context, projectKey, parentID string) ([]docstore.TreeItem, error) {
	s.index.Ensure(projectKey, s.projectRoot(projectKey))
	var targetDir string
	if parentID == "" || parentID == "root" {
		targetDir = filepath.Join(s.projectRoot(projectKey), "docs")
	} else {
		cache, ok := s.index.Get(projectKey, parentID)
		if !ok {
			return []docstore.TreeItem{}, nil
		}
		pPath := filepath.Join(s.projectRoot(projectKey), cache.Path)
		targetDir = pPath[:len(pPath)-len(filepath.Ext(pPath))]
	}

	order := s.readIndexFile(projectKey, targetDir)

	if len(order) == 0 {
		entries, _ := os.ReadDir(targetDir)
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".json") {
				relPath, _ := filepath.Rel(s.projectRoot(projectKey), filepath.Join(targetDir, e.Name()))
				id, _ := s.index.FindIDByPath(projectKey, relPath)
				if id != "" {
					order = append(order, id)
				}
			}
		}
		if len(order) > 0 {
			_ = s.writeIndexFile(targetDir, order)
		}
	}

	items := make([]docstore.TreeItem, 0, len(order))
	for _, docID := range order {
		cache, ok := s.index.Get(projectKey, docID)
		if !ok {
			continue
		}
		slug := strings.TrimSuffix(filepath.Base(cache.Path), filepath.Ext(cache.Path))
		kind := "file"
		info, err := os.Stat(filepath.Join(targetDir, slug))
		if err == nil && info.IsDir() {
			kind = "dir"
		}

		items = append(items, docstore.TreeItem{
			ID:    docID,
			Slug:  slug,
			Title: cache.Title,
			Kind:  kind,
		})
	}

	return items, nil
}

func (s *Service) GetHierarchy(ctx context.Context, projectKey, docID string) ([]docstore.DocumentMeta, error) {
	s.index.Ensure(projectKey, s.projectRoot(projectKey))
	docID = strings.TrimSpace(docID)
	if docID == "" {
		return nil, ErrNotFound
	}
	if _, ok := s.index.Get(projectKey, docID); !ok {
		return nil, ErrNotFound
	}

	chain := []docstore.DocumentMeta{}
	visited := map[string]struct{}{}
	currentID := docID
	for currentID != "" {
		if _, seen := visited[currentID]; seen {
			break
		}
		visited[currentID] = struct{}{}
		cache, ok := s.index.Get(projectKey, currentID)
		if !ok {
			break
		}
		chain = append(chain, docstore.DocumentMeta{
			ID:       currentID,
			Title:    cache.Title,
			ParentID: cache.ParentID,
		})
		parentID := strings.TrimSpace(cache.ParentID)
		if parentID == "" || parentID == "root" {
			break
		}
		currentID = parentID
	}

	reverseDocumentMeta(chain)
	return chain, nil
}

func normalizeSlug(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" {
		return ""
	}
	var out strings.Builder
	out.Grow(len(s))
	prevDash := false
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			out.WriteRune(r)
			prevDash = false
			continue
		}
		if r == '-' || r == '_' || unicode.IsSpace(r) {
			if prevDash || out.Len() == 0 {
				continue
			}
			out.WriteByte('-')
			prevDash = true
			continue
		}
		if prevDash || out.Len() == 0 {
			continue
		}
		out.WriteByte('-')
		prevDash = true
	}
	return strings.Trim(out.String(), "-")
}

func reverseDocumentMeta(items []docstore.DocumentMeta) {
	for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
		items[i], items[j] = items[j], items[i]
	}
}

func (s *Service) ensureUniqueSlug(dir, slug, myID string) string {
	base := slug
	count := 1
	for {
		filename := slug + ".json"
		path := filepath.Join(dir, filename)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			return slug
		}

		slug = fmt.Sprintf("%s-%d", base, count)
		count++
	}
}

func (s *Service) renameFileAndDir(oldPath, newPath string) error {
	if err := os.Rename(oldPath, newPath); err != nil {
		return err
	}
	oldDir := oldPath[:len(oldPath)-len(filepath.Ext(oldPath))]
	newDir := newPath[:len(newPath)-len(filepath.Ext(newPath))]
	info, err := os.Stat(oldDir)
	if err == nil && info.IsDir() {
		return os.Rename(oldDir, newDir)
	}
	return nil
}

func (s *Service) readIndexFile(projectKey, dir string) []string {
	data, err := os.ReadFile(filepath.Join(dir, ".index"))
	if err != nil {
		return []string{}
	}
	var entries []string
	_ = json.Unmarshal(data, &entries)
	if len(entries) == 0 {
		return []string{}
	}

	// .index stores document IDs, while filenames are slug.json.
	// Do not assume id == filename; validate against the in-memory index instead.
	resolved := make([]string, 0, len(entries))
	changed := false
	for _, entry := range entries {
		id := strings.TrimSpace(entry)
		if id == "" {
			changed = true
			continue
		}
		if _, ok := s.index.Get(projectKey, id); ok {
			resolved = append(resolved, id)
			continue
		}
		changed = true
	}

	// If index is partially missing, rebuild order from files in directory.
	if changed {
		seen := make(map[string]struct{}, len(resolved))
		for _, id := range resolved {
			seen[id] = struct{}{}
		}
		repaired := s.collectIDsFromDir(projectKey, dir, seen)
		if len(repaired) > 0 {
			resolved = append(resolved, repaired...)
		}
	}
	if changed {
		_ = s.writeIndexFile(dir, resolved)
	}
	return resolved
}

// collectIDsFromDir scans JSON documents under dir and returns IDs not in seen.
func (s *Service) collectIDsFromDir(projectKey, dir string, seen map[string]struct{}) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		fullPath := filepath.Join(dir, entry.Name())
		data, err := os.ReadFile(fullPath)
		if err != nil {
			continue
		}
		var partial struct {
			Meta docstore.DocumentMeta `json:"meta"`
		}
		if err := json.Unmarshal(data, &partial); err != nil {
			continue
		}
		id := strings.TrimSpace(partial.Meta.ID)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		if _, ok := s.index.Get(projectKey, id); ok {
			ids = append(ids, id)
			seen[id] = struct{}{}
		}
	}
	return ids
}

func (s *Service) writeIndexFile(dir string, docIDs []string) error {
	data, _ := json.Marshal(docIDs)
	return os.WriteFile(filepath.Join(dir, ".index"), data, 0644)
}

func (s *Service) addToIndexFile(projectKey, dir, docID string) {
	ids := s.readIndexFile(projectKey, dir)
	for _, x := range ids {
		if x == docID {
			return
		}
	}
	ids = append(ids, docID)
	_ = s.writeIndexFile(dir, ids)
}

func (s *Service) removeFromIndexFile(projectKey, dir, docID string) {
	ids := s.readIndexFile(projectKey, dir)
	filtered := make([]string, 0, len(ids))
	for _, x := range ids {
		if x != docID {
			filtered = append(filtered, x)
		}
	}
	_ = s.writeIndexFile(dir, filtered)
}

func (s *Service) reorderIndexFile(
	projectKey,
	dir,
	docID,
	beforeDocID,
	afterDocID string,
	insert bool,
) error {
	ids := s.readIndexFile(projectKey, dir)
	filtered := make([]string, 0, len(ids))
	for _, x := range ids {
		if x != docID {
			filtered = append(filtered, x)
		}
	}

	if !insert {
		return s.writeIndexFile(dir, filtered)
	}

	insertAt := len(filtered)
	if beforeDocID != "" {
		if idx := indexOf(filtered, beforeDocID); idx >= 0 {
			insertAt = idx
		}
	} else if afterDocID != "" {
		if idx := indexOf(filtered, afterDocID); idx >= 0 {
			insertAt = idx + 1
		}
	}

	if insertAt < 0 || insertAt > len(filtered) {
		insertAt = len(filtered)
	}
	filtered = append(filtered, "")
	copy(filtered[insertAt+1:], filtered[insertAt:])
	filtered[insertAt] = docID

	return s.writeIndexFile(dir, filtered)
}

func indexOf(items []string, value string) int {
	for i, item := range items {
		if item == value {
			return i
		}
	}
	return -1
}
