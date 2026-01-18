package docstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"zeus/internal/domain/docstore"
)

var (
	ErrNotFound = errors.New("document not found")
	slugRegexp  = regexp.MustCompile(`[^a-z0-9\-]`)
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
			s.updateIndexSlug(targetDir, filepath.Base(oldFullPath), filename)
		}
	} else {
		s.addToIndexFile(targetDir, finalSlug)
	}

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

	return nil
}

func (s *impl) Delete(ctx context.Context, projectID, docID string) error {
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
	slug := strings.TrimSuffix(filepath.Base(fullPath), ext)
	s.removeFromIndexFile(parentDir, slug)

	s.index.Remove(docID)

	return nil
}

func (s *impl) Move(ctx context.Context, projectID, docID, targetParentID string, targetIndex int) error {
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

		s.removeFromIndexFile(oldDir, slug)
		s.addToIndexFile(targetDir, newSlug)

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

	slug := strings.TrimSuffix(filepath.Base(newPath), filepath.Ext(newPath))
	return s.reorderIndexFile(targetDir, slug, targetIndex)
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
				order = append(order, strings.TrimSuffix(e.Name(), ".json"))
			}
		}
	}

	items := make([]docstore.TreeItem, 0, len(order))
	for _, slug := range order {
		relPath, _ := filepath.Rel(s.rootDir, filepath.Join(targetDir, slug+".json"))

		var matchedID, title string
		matchedID = s.findIDByPath(relPath)

		if matchedID != "" {
			cache, _ := s.index.Get(matchedID)
			title = cache.Title
		} else {
			title = slug
		}

		kind := "file"
		info, err := os.Stat(filepath.Join(targetDir, slug))
		if err == nil && info.IsDir() {
			kind = "dir"
		}

		items = append(items, docstore.TreeItem{
			ID:    matchedID,
			Slug:  slug,
			Title: title,
			Kind:  kind,
		})
	}

	return items, nil
}

func normalizeSlug(s string) string {
	s = strings.ToLower(s)
	s = slugRegexp.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
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
	var slugs []string
	_ = json.Unmarshal(data, &slugs)
	return slugs
}

func (s *impl) writeIndexFile(dir string, slugs []string) error {
	data, _ := json.Marshal(slugs)
	return os.WriteFile(filepath.Join(dir, ".index"), data, 0644)
}

func (s *impl) addToIndexFile(dir, slug string) {
	slugs := s.readIndexFile(dir)
	for _, x := range slugs {
		if x == slug {
			return
		}
	}
	slugs = append(slugs, slug)
	_ = s.writeIndexFile(dir, slugs)
}

func (s *impl) removeFromIndexFile(dir, slug string) {
	slugs := s.readIndexFile(dir)
	newSlugs := make([]string, 0, len(slugs))
	for _, x := range slugs {
		if x != slug {
			newSlugs = append(newSlugs, x)
		}
	}
	_ = s.writeIndexFile(dir, newSlugs)
}

func (s *impl) updateIndexSlug(dir, oldSlug, newSlug string) {
	slugs := s.readIndexFile(dir)
	for i, x := range slugs {
		if x == oldSlug {
			slugs[i] = newSlug
		}
	}
	_ = s.writeIndexFile(dir, slugs)
}

func (s *impl) reorderIndexFile(dir, slug string, index int) error {
	slugs := s.readIndexFile(dir)
	filtered := make([]string, 0, len(slugs))
	for _, x := range slugs {
		if x != slug {
			filtered = append(filtered, x)
		}
	}

	if index < 0 || index >= len(filtered) {
		filtered = append(filtered, slug)
	} else {
		filtered = append(filtered[:index+1], filtered[index:]...)
		filtered[index] = slug
	}

	return s.writeIndexFile(dir, filtered)
}

func (s *impl) findIDByPath(relPath string) string {
	id, _ := s.index.FindIDByPath(relPath)
	return id
}
