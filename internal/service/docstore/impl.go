package docstore

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

func (s *impl) Get(ctx context.Context, projectID, docID string) (*docstore.Document, error) {
	cache, ok := s.index.Get(docID)
	if !ok {
		return nil, ErrNotFound
	}

	fullPath := filepath.Join(s.rootDir, cache.Path)
	data, err := os.ReadFile(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			s.index.Remove(docID)
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

func (s *impl) Save(ctx context.Context, projectID string, doc *docstore.Document) error {
	hookCtx := docstore.HookContext{ProjectID: projectID}
	for _, hook := range s.hooks.BeforeSave {
		if err := hook(hookCtx, doc); err != nil {
			return err
		}
	}

	cache, exists := s.index.Get(doc.Meta.ID)

	var targetDir string
	if exists {
		currentPath := filepath.Join(s.rootDir, cache.Path)
		targetDir = filepath.Dir(currentPath)
	} else {
		if doc.Meta.ParentID != "" && doc.Meta.ParentID != "root" {
			parentCache, ok := s.index.Get(doc.Meta.ParentID)
			if !ok {
				return errors.New("parent document not found")
			}
			parentPath := filepath.Join(s.rootDir, parentCache.Path)
			ext := filepath.Ext(parentPath)
			targetDir = parentPath[:len(parentPath)-len(ext)]
		} else {
			targetDir = filepath.Join(s.rootDir, "docs")
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
		oldFullPath := filepath.Join(s.rootDir, cache.Path)
		if oldFullPath != fullPath {
			if err := s.renameFileAndDir(oldFullPath, fullPath); err != nil {
				return err
			}
			oldDir := filepath.Dir(oldFullPath)
			if oldDir != targetDir {
				s.removeFromIndexFile(oldDir, doc.Meta.ID)
			}
		}
	}
	s.addToIndexFile(targetDir, doc.Meta.ID)

	doc.Meta.Path, _ = filepath.Rel(s.rootDir, fullPath)
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

	relPath, _ := filepath.Rel(s.rootDir, fullPath)
	s.index.Update(doc.Meta.ID, CachedDoc{
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

func (s *impl) Delete(ctx context.Context, projectID, docID string) error {
	hookCtx := docstore.HookContext{ProjectID: projectID}
	for _, hook := range s.hooks.BeforeDelete {
		if err := hook(hookCtx, docID); err != nil {
			return err
		}
	}

	cache, ok := s.index.Get(docID)
	if !ok {
		return ErrNotFound
	}

	fullPath := filepath.Join(s.rootDir, cache.Path)

	if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
		return err
	}

	ext := filepath.Ext(fullPath)
	companionDir := fullPath[:len(fullPath)-len(ext)]
	_ = os.RemoveAll(companionDir)

	parentDir := filepath.Dir(fullPath)
	s.removeFromIndexFile(parentDir, docID)

	s.index.Remove(docID)

	for _, hook := range s.hooks.AfterDelete {
		if err := hook(hookCtx, docID); err != nil {
			return err
		}
	}

	return nil
}

func (s *impl) Move(ctx context.Context, projectID, docID, targetParentID, beforeDocID, afterDocID string) error {
	hookCtx := docstore.HookContext{ProjectID: projectID}
	for _, hook := range s.hooks.BeforeMove {
		if err := hook(hookCtx, docID, targetParentID); err != nil {
			return err
		}
	}

	cache, ok := s.index.Get(docID)
	if !ok {
		return ErrNotFound
	}
	oldPath := filepath.Join(s.rootDir, cache.Path)

	var targetDir string
	if targetParentID == "" || targetParentID == "root" {
		targetDir = filepath.Join(s.rootDir, "docs")
	} else {
		pCache, ok := s.index.Get(targetParentID)
		if !ok {
			return errors.New("target parent not found")
		}
		pPath := filepath.Join(s.rootDir, pCache.Path)
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

		relPath, _ := filepath.Rel(s.rootDir, newPath)
		s.index.Update(docID, CachedDoc{
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
		if err := s.reorderIndexFile(oldDir, docID, "", "", false); err != nil {
			return err
		}
	}
	if err := s.reorderIndexFile(targetDir, docID, beforeDocID, afterDocID, true); err != nil {
		return err
	}

	for _, hook := range s.hooks.AfterMove {
		if err := hook(hookCtx, docID, targetParentID); err != nil {
			return err
		}
	}

	return nil
}

func (s *impl) GetChildren(ctx context.Context, projectID, parentID string) ([]docstore.TreeItem, error) {
	var targetDir string
	if parentID == "" || parentID == "root" {
		targetDir = filepath.Join(s.rootDir, "docs")
	} else {
		cache, ok := s.index.Get(parentID)
		if !ok {
			return []docstore.TreeItem{}, nil
		}
		pPath := filepath.Join(s.rootDir, cache.Path)
		targetDir = pPath[:len(pPath)-len(filepath.Ext(pPath))]
	}

	order := s.readIndexFile(targetDir)

	if len(order) == 0 {
		entries, _ := os.ReadDir(targetDir)
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".json") {
				relPath, _ := filepath.Rel(s.rootDir, filepath.Join(targetDir, e.Name()))
				id, _ := s.index.FindIDByPath(relPath)
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
		cache, ok := s.index.Get(docID)
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

func (s *impl) GetHierarchy(ctx context.Context, projectID, docID string) ([]docstore.DocumentMeta, error) {
	docID = strings.TrimSpace(docID)
	if docID == "" {
		return nil, ErrNotFound
	}
	if _, ok := s.index.Get(docID); !ok {
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
		cache, ok := s.index.Get(currentID)
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

func (s *impl) ensureUniqueSlug(dir, slug, myID string) string {
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

func (s *impl) renameFileAndDir(oldPath, newPath string) error {
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

func (s *impl) readIndexFile(dir string) []string {
	data, err := os.ReadFile(filepath.Join(dir, ".index"))
	if err != nil {
		return []string{}
	}
	var entries []string
	_ = json.Unmarshal(data, &entries)
	if len(entries) == 0 {
		return []string{}
	}

	resolved := make([]string, 0, len(entries))
	changed := false
	for _, entry := range entries {
		id := strings.TrimSpace(entry)
		if id == "" {
			changed = true
			continue
		}
		if _, ok := s.index.Get(id); ok {
			resolved = append(resolved, id)
			continue
		}

		relPath, _ := filepath.Rel(s.rootDir, filepath.Join(dir, id+".json"))
		if docID := s.findIDByPath(relPath); docID != "" {
			resolved = append(resolved, docID)
			changed = true
			continue
		}
		changed = true
	}
	if changed {
		_ = s.writeIndexFile(dir, resolved)
	}
	return resolved
}

func (s *impl) writeIndexFile(dir string, docIDs []string) error {
	data, _ := json.Marshal(docIDs)
	return os.WriteFile(filepath.Join(dir, ".index"), data, 0644)
}

func (s *impl) addToIndexFile(dir, docID string) {
	ids := s.readIndexFile(dir)
	for _, x := range ids {
		if x == docID {
			return
		}
	}
	ids = append(ids, docID)
	_ = s.writeIndexFile(dir, ids)
}

func (s *impl) removeFromIndexFile(dir, docID string) {
	ids := s.readIndexFile(dir)
	filtered := make([]string, 0, len(ids))
	for _, x := range ids {
		if x != docID {
			filtered = append(filtered, x)
		}
	}
	_ = s.writeIndexFile(dir, filtered)
}

func (s *impl) reorderIndexFile(
	dir,
	docID,
	beforeDocID,
	afterDocID string,
	insert bool,
) error {
	ids := s.readIndexFile(dir)
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

func (s *impl) findIDByPath(relPath string) string {
	id, _ := s.index.FindIDByPath(relPath)
	return id
}

func indexOf(items []string, value string) int {
	for i, item := range items {
		if item == value {
			return i
		}
	}
	return -1
}
