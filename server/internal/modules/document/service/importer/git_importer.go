package importer

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"zeus/internal/domain"
	"zeus/internal/infra/gitclient"
	docservice "zeus/internal/modules/document/service"

	"github.com/google/uuid"
)

const (
	maxGitImportFiles = 2000
	maxGitImportBytes = int64(2 * 1024 * 1024)
)

type GitImportRequest struct {
	RepoURL  string
	Branch   string
	Subdir   string
	ParentID string
}

type GitImportResult struct {
	Directories int
	Files       int
	Skipped     int
}

type GitImporter struct {
	docSvc        docservice.DocumentService
	repoRoot      string
	sessionRoot   string
	defaultBranch string
}

func NewGitImporter(
	docSvc docservice.DocumentService,
	repoRoot string,
	sessionRoot string,
	defaultBranch string,
) *GitImporter {
	return &GitImporter{
		docSvc:        docSvc,
		repoRoot:      strings.TrimSpace(repoRoot),
		sessionRoot:   strings.TrimSpace(sessionRoot),
		defaultBranch: strings.TrimSpace(defaultBranch),
	}
}

func (s *GitImporter) Import(ctx context.Context, projectKey string, req GitImportRequest) (GitImportResult, error) {
	if s == nil || s.docSvc == nil {
		return GitImportResult{}, fmt.Errorf("git importer not initialized")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return GitImportResult{}, fmt.Errorf("project key is required")
	}
	repoURL := strings.TrimSpace(req.RepoURL)
	if repoURL == "" {
		return GitImportResult{}, fmt.Errorf("repo_url is required")
	}
	if !isHTTPRepo(repoURL) {
		return GitImportResult{}, fmt.Errorf("repo_url must be http or https")
	}

	branch := strings.TrimSpace(req.Branch)
	if branch == "" {
		branch = s.defaultBranch
	}
	if branch == "" {
		branch = "main"
	}

	sessionRoot := s.sessionRoot
	if sessionRoot == "" {
		sessionRoot = os.TempDir()
	}
	if err := os.MkdirAll(sessionRoot, 0o755); err != nil {
		return GitImportResult{}, fmt.Errorf("ensure git session root: %w", err)
	}

	tempDir, err := os.MkdirTemp(sessionRoot, "git-import-")
	if err != nil {
		return GitImportResult{}, fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tempDir)

	client := gitclient.NewGitClient(
		gitclient.GitKey(uuid.NewString()),
		gitclient.WithRepoPath(tempDir),
		gitclient.WithRemoteURL(repoURL),
		gitclient.WithBranch(branch),
		gitclient.WithInitFunc(gitclient.DefaultInitFunc),
	)

	if err := client.EnsureReady(ctx); err != nil {
		return GitImportResult{}, err
	}
	if err := client.Pull(ctx, "origin", branch); err != nil {
		return GitImportResult{}, err
	}

	baseDir, rootTitle, err := resolveImportRoot(tempDir, req.Subdir)
	if err != nil {
		return GitImportResult{}, err
	}

	parentID := strings.TrimSpace(req.ParentID)
	if parentID == "" {
		parentID = "root"
	}

	directoryIDs := map[string]string{}

	if rootTitle != "" {
		docID, err := s.createFolderDoc(ctx, projectKey, rootTitle, parentID)
		if err != nil {
			return GitImportResult{}, err
		}
		directoryIDs["."] = docID
		parentID = docID
	}

	directories, files, err := scanGitImportEntries(baseDir)
	if err != nil {
		return GitImportResult{}, err
	}

	sort.Slice(directories, func(i, j int) bool {
		if directories[i].depth != directories[j].depth {
			return directories[i].depth < directories[j].depth
		}
		return directories[i].path < directories[j].path
	})

	result := GitImportResult{}
	for _, dir := range directories {
		parentPath := dir.parent
		if parentPath == "" {
			parentPath = "."
		}
		resolvedParent := parentID
		if parentPath != "." {
			if id, ok := directoryIDs[parentPath]; ok {
				resolvedParent = id
			}
		} else if id, ok := directoryIDs["."]; ok {
			resolvedParent = id
		}

		docID, err := s.createFolderDoc(ctx, projectKey, dir.name, resolvedParent)
		if err != nil {
			return result, err
		}
		directoryIDs[dir.path] = docID
		result.Directories += 1
	}

	for _, file := range files {
		if result.Files+result.Skipped >= maxGitImportFiles {
			result.Skipped += 1
			continue
		}
		info, err := os.Stat(file.fullPath)
		if err != nil {
			result.Skipped += 1
			continue
		}
		if info.Size() > maxGitImportBytes {
			result.Skipped += 1
			continue
		}
		content, err := os.ReadFile(file.fullPath)
		if err != nil {
			result.Skipped += 1
			continue
		}
		parentPath := file.parent
		resolvedParent := parentID
		if parentPath != "" {
			if id, ok := directoryIDs[parentPath]; ok {
				resolvedParent = id
			}
		}
		if err := s.createMarkdownDoc(ctx, projectKey, file.title, resolvedParent, string(content)); err != nil {
			return result, err
		}
		result.Files += 1
	}

	return result, nil
}

func resolveImportRoot(repoRoot string, subdir string) (string, string, error) {
	root := filepath.Clean(strings.TrimSpace(subdir))
	if root == "" || root == "." {
		return repoRoot, "", nil
	}
	if strings.HasPrefix(root, "..") || strings.Contains(root, string(filepath.Separator)+"..") {
		return "", "", fmt.Errorf("invalid subdir")
	}
	full := filepath.Join(repoRoot, root)
	rel, err := filepath.Rel(repoRoot, full)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", "", fmt.Errorf("invalid subdir")
	}
	info, err := os.Stat(full)
	if err != nil {
		return "", "", fmt.Errorf("subdir not found")
	}
	if !info.IsDir() {
		return "", "", fmt.Errorf("subdir is not a directory")
	}
	return full, filepath.Base(root), nil
}

type gitDirEntry struct {
	path   string
	parent string
	name   string
	depth  int
}

type gitFileEntry struct {
	fullPath string
	parent   string
	title    string
	ext      string
}

func scanGitImportEntries(baseDir string) ([]gitDirEntry, []gitFileEntry, error) {
	directories := []gitDirEntry{}
	files := []gitFileEntry{}

	err := filepath.WalkDir(baseDir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		name := d.Name()
		if name == ".git" {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(baseDir, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		if d.IsDir() {
			depth := strings.Count(rel, string(filepath.Separator))
			parent := filepath.Dir(rel)
			if parent == "." {
				parent = ""
			}
			directories = append(directories, gitDirEntry{
				path:   rel,
				parent: parent,
				name:   filepath.Base(rel),
				depth:  depth,
			})
			return nil
		}
		ext := strings.ToLower(filepath.Ext(rel))
		if !isMarkdownExt(ext) && !isTextExt(ext) {
			return nil
		}
		title := strings.TrimSuffix(filepath.Base(rel), ext)
		parent := filepath.Dir(rel)
		if parent == "." {
			parent = ""
		}
		files = append(files, gitFileEntry{
			fullPath: path,
			parent:   parent,
			title:    title,
			ext:      ext,
		})
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return directories, files, nil
}

func (s *GitImporter) createFolderDoc(ctx context.Context, projectKey, title, parentID string) (string, error) {
	docID := uuid.NewString()
	meta := domain.DocumentMeta{
		ID:            docID,
		SchemaVersion: "v1",
		Title:         title,
		ParentID:      parentID,
		Extra: map[string]any{
			"status":   "draft",
			"tags":     []string{},
			"doc_type": "folder",
		},
	}
	body := domain.DocumentBody{
		Type: "tiptap",
		Content: map[string]any{
			"type":    "doc",
			"content": []any{},
		},
	}
	doc := &domain.Document{Meta: meta, Body: body}
	if err := s.docSvc.Save(ctx, projectKey, doc); err != nil {
		return "", err
	}
	if s.repoRoot != "" && doc.Meta.Path != "" {
		fullPath := filepath.Join(s.repoRoot, projectKey, doc.Meta.Path)
		ext := filepath.Ext(fullPath)
		if ext != "" {
			companion := strings.TrimSuffix(fullPath, ext)
			_ = os.MkdirAll(companion, 0o755)
		}
	}
	return docID, nil
}

func (s *GitImporter) createMarkdownDoc(ctx context.Context, projectKey, title, parentID, markdown string) error {
	if strings.TrimSpace(markdown) == "" {
		return errors.New("empty markdown")
	}
	docID := uuid.NewString()
	meta := domain.DocumentMeta{
		ID:            docID,
		SchemaVersion: "v1",
		Title:         title,
		ParentID:      parentID,
		Extra: map[string]any{
			"status": "draft",
			"tags":   []string{},
		},
	}
	body := domain.DocumentBody{
		Type:    "tiptap",
		Content: buildPlainTextDoc(markdown),
	}
	doc := &domain.Document{Meta: meta, Body: body}
	return s.docSvc.Save(ctx, projectKey, doc)
}

func buildPlainTextDoc(text string) map[string]any {
	return map[string]any{
		"type": "doc",
		"content": []any{
			map[string]any{
				"type": "paragraph",
				"content": []any{
					map[string]any{
						"type": "text",
						"text": text,
					},
				},
			},
		},
	}
}

func isHTTPRepo(value string) bool {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://")
}

func isMarkdownExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".md", ".markdown":
		return true
	default:
		return false
	}
}

func isTextExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".txt":
		return true
	default:
		return false
	}
}
