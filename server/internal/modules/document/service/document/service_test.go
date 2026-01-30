package document

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"zeus/internal/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testProjectID = "proj-1"

func setup(t *testing.T) (*Service, string) {
	tmpDir := t.TempDir()
	return &Service{repoRoot: tmpDir, index: NewIndexManager()}, filepath.Join(tmpDir, testProjectID)
}

func newDoc(id, title string) *domain.Document {
	return &domain.Document{
		Meta: domain.DocumentMeta{
			ID:    id,
			Title: title,
		},
		Body: domain.DocumentBody{
			Type:    "markdown",
			Content: "hello world",
		},
	}
}

func TestService_Save_New(t *testing.T) {
	svc, root := setup(t)
	ctx := context.Background()

	doc := newDoc("doc-1", "My First Doc")
	err := svc.Save(ctx, testProjectID, doc)
	require.NoError(t, err)

	// Check File Existence (slug should be normalized)
	expectedPath := filepath.Join(root, "docs", "my-first-doc.json")
	require.FileExists(t, expectedPath)

	// Check Content
	savedDoc, err := svc.Get(ctx, testProjectID, "doc-1")
	require.NoError(t, err)
	assert.Equal(t, "my-first-doc", savedDoc.Meta.Slug)
	assert.Equal(t, "docs/my-first-doc.json", savedDoc.Meta.Path)
}

func TestService_Save_UnicodeSlug(t *testing.T) {
	svc, root := setup(t)
	ctx := context.Background()

	doc := newDoc("doc-cn", "中文 文档")
	err := svc.Save(ctx, testProjectID, doc)
	require.NoError(t, err)

	expectedSlug := "中文-文档"
	assert.FileExists(t, filepath.Join(root, "docs", expectedSlug+".json"))

	savedDoc, err := svc.Get(ctx, testProjectID, "doc-cn")
	require.NoError(t, err)
	assert.Equal(t, expectedSlug, savedDoc.Meta.Slug)
}

func TestService_Save_Rename(t *testing.T) {
	svc, root := setup(t)
	ctx := context.Background()

	// 1. Create original
	doc := newDoc("doc-1", "Original Title")
	require.NoError(t, svc.Save(ctx, testProjectID, doc))

	// Create a companion directory to test if it moves too
	oldDir := filepath.Join(root, "docs", "original-title")
	require.NoError(t, os.MkdirAll(oldDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(oldDir, "child.txt"), []byte("child"), 0644))

	// 2. Rename
	doc.Meta.Slug = "new-title" // Manually set new slug (simulating frontend)
	doc.Meta.Title = "New Title"
	err := svc.Save(ctx, testProjectID, doc)
	require.NoError(t, err)

	// 3. Verify
	// Old gone
	assert.NoFileExists(t, filepath.Join(root, "docs", "original-title.json"))
	assert.NoDirExists(t, oldDir)

	// New exists
	assert.FileExists(t, filepath.Join(root, "docs", "new-title.json"))
	assert.DirExists(t, filepath.Join(root, "docs", "new-title"))
	assert.FileExists(t, filepath.Join(root, "docs", "new-title", "child.txt"))
}

func TestService_Save_Collision(t *testing.T) {
	svc, root := setup(t)
	ctx := context.Background()

	// Create Doc A
	docA := newDoc("doc-a", "Api Doc")
	require.NoError(t, svc.Save(ctx, testProjectID, docA))
	assert.FileExists(t, filepath.Join(root, "docs", "api-doc.json"))

	// Create Doc B with SAME Title -> Should get suffix
	docB := newDoc("doc-b", "Api Doc")
	require.NoError(t, svc.Save(ctx, testProjectID, docB))

	assert.FileExists(t, filepath.Join(root, "docs", "api-doc-1.json"))

	// Read back to verify slug
	savedB, _ := svc.Get(ctx, testProjectID, "doc-b")
	assert.Equal(t, "api-doc-1", savedB.Meta.Slug)
}

func TestService_Move_Reparent(t *testing.T) {
	svc, root := setup(t)
	ctx := context.Background()

	// Structure:
	// docs/
	//   parent.json
	//   parent/
	//   child.json

	parent := newDoc("parent-1", "Parent")
	require.NoError(t, svc.Save(ctx, testProjectID, parent))

	child := newDoc("child-1", "Child")
	require.NoError(t, svc.Save(ctx, testProjectID, child))

	// Move Child -> Parent
	err := svc.Move(ctx, testProjectID, "child-1", "parent-1", "", "")
	require.NoError(t, err)

	// Verify Location
	assert.FileExists(t, filepath.Join(root, "docs", "parent", "child.json"))
	assert.NoFileExists(t, filepath.Join(root, "docs", "child.json"))

	// Verify Metadata
	moved, _ := svc.Get(ctx, testProjectID, "child-1")
	assert.Equal(t, "parent-1", moved.Meta.ParentID)
}

func TestService_GetChildren_Ordering(t *testing.T) {
	svc, _ := setup(t)
	ctx := context.Background()

	// Create 3 docs
	d1 := newDoc("d1", "A")
	d2 := newDoc("d2", "B")
	d3 := newDoc("d3", "C")

	require.NoError(t, svc.Save(ctx, testProjectID, d1))
	require.NoError(t, svc.Save(ctx, testProjectID, d2))
	require.NoError(t, svc.Save(ctx, testProjectID, d3))

	// Reorder: C, A, B
	// Move(d3, root, 0) places C at top
	// Move(d1, root, 1) places A at 1
	// B is last
	require.NoError(t, svc.Move(ctx, testProjectID, "d3", "root", "d1", ""))

	// GetChildren
	items, err := svc.GetChildren(ctx, testProjectID, "root")
	require.NoError(t, err)

	require.Len(t, items, 3)
	assert.Equal(t, "d3", items[0].ID) // C
	// We didn't strictly force d1 to pos 1, so it might be 2 depending on default append.
	// But d3 SHOULD be first.
}

func TestService_GetHierarchy(t *testing.T) {
	svc, _ := setup(t)
	ctx := context.Background()

	parent := newDoc("parent-doc", "Parent")
	require.NoError(t, svc.Save(ctx, testProjectID, parent))

	child := newDoc("child-doc", "Child")
	child.Meta.ParentID = "parent-doc"
	require.NoError(t, svc.Save(ctx, testProjectID, child))

	grand := newDoc("grand-doc", "Grand")
	grand.Meta.ParentID = "child-doc"
	require.NoError(t, svc.Save(ctx, testProjectID, grand))

	hierarchy, err := svc.GetHierarchy(ctx, testProjectID, "grand-doc")
	require.NoError(t, err)
	require.Len(t, hierarchy, 3)
	assert.Equal(t, "parent-doc", hierarchy[0].ID)
	assert.Equal(t, "child-doc", hierarchy[1].ID)
	assert.Equal(t, "grand-doc", hierarchy[2].ID)
	assert.Equal(t, "", hierarchy[0].ParentID)
	assert.Equal(t, "parent-doc", hierarchy[1].ParentID)
	assert.Equal(t, "child-doc", hierarchy[2].ParentID)

	_, err = svc.GetHierarchy(ctx, testProjectID, "missing")
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestService_Delete(t *testing.T) {
	svc, root := setup(t)
	ctx := context.Background()

	doc := newDoc("doc-del", "To Delete")
	require.NoError(t, svc.Save(ctx, testProjectID, doc))

	// Create companion dir
	dir := filepath.Join(root, "docs", "to-delete")
	os.MkdirAll(dir, 0755)

	err := svc.Delete(ctx, testProjectID, "doc-del")
	require.NoError(t, err)

	assert.NoFileExists(t, filepath.Join(root, "docs", "to-delete.json"))
	assert.NoDirExists(t, dir)

	_, err = svc.Get(ctx, testProjectID, "doc-del")
	assert.Error(t, err)
}

func TestService_GetBlockByID(t *testing.T) {
	svc, _ := setup(t)
	ctx := context.Background()

	doc := &domain.Document{
		Meta: domain.DocumentMeta{
			ID:    "block-doc",
			Title: "Block Doc",
		},
		Body: domain.DocumentBody{
			Type: "tiptap",
			Content: map[string]any{
				"meta": map[string]any{
					"zeus": true,
				},
				"content": map[string]any{
					"type": "doc",
					"content": []any{
						map[string]any{
							"type": "paragraph",
							"attrs": map[string]any{
								"id": "block-1",
							},
							"content": []any{
								map[string]any{
									"type": "text",
									"text": "hello",
								},
							},
						},
						map[string]any{
							"type": "heading",
							"attrs": map[string]any{
								"id": "block-2",
							},
							"content": []any{
								map[string]any{
									"type": "text",
									"text": "world",
								},
							},
						},
					},
				},
			},
		},
	}
	require.NoError(t, svc.Save(ctx, testProjectID, doc))

	blockDoc, err := svc.GetBlockByID(ctx, testProjectID, "block-doc", "block-2")
	require.NoError(t, err)
	require.NotNil(t, blockDoc)
	assert.Equal(t, "block-doc", blockDoc.Meta.ID)

	bodyContent, ok := blockDoc.Body.Content.(map[string]any)
	require.True(t, ok)
	contentRoot, ok := bodyContent["content"].(map[string]any)
	require.True(t, ok)
	children, ok := contentRoot["content"].([]any)
	require.True(t, ok)
	require.Len(t, children, 1)
	block, ok := children[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "heading", block["type"])

	attrs, ok := block["attrs"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "block-2", attrs["id"])

	_, err = svc.GetBlockByID(ctx, testProjectID, "block-doc", "missing")
	assert.ErrorIs(t, err, ErrBlockNotFound)
}

// Helpers for testing persistence between Service restarts
func TestService_Restart_RebuildIndex(t *testing.T) {
	tmpDir := t.TempDir()

	// 1. Start Service A, create data
	svcA := NewService(tmpDir)
	doc := newDoc("persist-1", "Persistent Doc")
	svcA.Save(context.Background(), testProjectID, doc)

	// 2. Start Service B (Simulate Restart)
	svcB := NewService(tmpDir)

	// 3. Verify B can find data via Index Rebuild
	loaded, err := svcB.Get(context.Background(), testProjectID, "persist-1")
	require.NoError(t, err)
	assert.Equal(t, "Persistent Doc", loaded.Meta.Title)
}

func TestService_GetChildren_RepairsIndexWithoutDuplicates(t *testing.T) {
	svc, root := setup(t)
	ctx := context.Background()

	// Create three documents.
	d1 := newDoc("doc-1", "Alpha")
	d2 := newDoc("doc-2", "Beta")
	d3 := newDoc("doc-3", "Gamma")
	require.NoError(t, svc.Save(ctx, testProjectID, d1))
	require.NoError(t, svc.Save(ctx, testProjectID, d2))
	require.NoError(t, svc.Save(ctx, testProjectID, d3))

	indexPath := filepath.Join(root, "docs", ".index")
	require.FileExists(t, indexPath)

	// Corrupt index: keep only the first ID.
	require.NoError(t, os.WriteFile(indexPath, []byte("[\"doc-1\"]"), 0644))

	items, err := svc.GetChildren(ctx, testProjectID, "root")
	require.NoError(t, err)
	require.Len(t, items, 3)

	seen := map[string]struct{}{}
	for _, item := range items {
		if _, ok := seen[item.ID]; ok {
			t.Fatalf("duplicate doc id %s", item.ID)
		}
		seen[item.ID] = struct{}{}
	}

	// .index should be repaired to include all IDs, without duplicates.
	data, err := os.ReadFile(indexPath)
	require.NoError(t, err)
	var ids []string
	require.NoError(t, json.Unmarshal(data, &ids))
	require.Len(t, ids, 3)
	unique := map[string]struct{}{}
	for _, id := range ids {
		if _, ok := unique[id]; ok {
			t.Fatalf("duplicate id %s in index", id)
		}
		unique[id] = struct{}{}
	}
}

func TestService_GetChildren_RepairsIndexWithMissingEntry(t *testing.T) {
	svc, root := setup(t)
	ctx := context.Background()

	// Create two documents.
	d1 := newDoc("doc-a", "Alpha")
	d2 := newDoc("doc-b", "Beta")
	require.NoError(t, svc.Save(ctx, testProjectID, d1))
	require.NoError(t, svc.Save(ctx, testProjectID, d2))

	indexPath := filepath.Join(root, "docs", ".index")

	// Drop doc-b from index.
	require.NoError(t, os.WriteFile(indexPath, []byte("[\"doc-a\"]"), 0644))

	items, err := svc.GetChildren(ctx, testProjectID, "root")
	require.NoError(t, err)
	require.Len(t, items, 2)

	// Ensure both are present.
	found := map[string]bool{"doc-a": false, "doc-b": false}
	for _, item := range items {
		found[item.ID] = true
	}
	if !found["doc-a"] || !found["doc-b"] {
		t.Fatalf("expected both documents to be listed")
	}
}

func TestService_Hooks(t *testing.T) {
	svc, _ := setup(t)
	ctx := context.Background()

	var callLog []string

	hooks := domain.Hooks{
		BeforeSave: []func(ctx domain.HookContext, doc *domain.Document) error{
			func(ctx domain.HookContext, doc *domain.Document) error {
				callLog = append(callLog, "BeforeSave1:"+doc.Meta.Title)
				return nil
			},
		},
		AfterSave: []func(ctx domain.HookContext, doc *domain.Document) error{
			func(ctx domain.HookContext, doc *domain.Document) error {
				callLog = append(callLog, "AfterSave1:"+doc.Meta.Title)
				return nil
			},
		},
		BeforeDelete: []func(ctx domain.HookContext, docID string) error{
			func(ctx domain.HookContext, docID string) error {
				callLog = append(callLog, "BeforeDelete1:"+docID)
				return nil
			},
		},
		AfterDelete: []func(ctx domain.HookContext, docID string) error{
			func(ctx domain.HookContext, docID string) error {
				callLog = append(callLog, "AfterDelete1:"+docID)
				return nil
			},
		},
		BeforeMove: []func(ctx domain.HookContext, docID, targetParentID string) error{
			func(ctx domain.HookContext, docID, targetParentID string) error {
				callLog = append(callLog, "BeforeMove1:"+docID)
				return nil
			},
		},
		AfterMove: []func(ctx domain.HookContext, docID, targetParentID string) error{
			func(ctx domain.HookContext, docID, targetParentID string) error {
				callLog = append(callLog, "AfterMove1:"+docID)
				return nil
			},
		},
	}

	hooks2 := domain.Hooks{
		BeforeSave: []func(ctx domain.HookContext, doc *domain.Document) error{
			func(ctx domain.HookContext, doc *domain.Document) error {
				callLog = append(callLog, "BeforeSave2:"+doc.Meta.Title)
				return nil
			},
		},
	}

	svc.RegisterHooks(hooks)
	svc.RegisterHooks(hooks2)

	doc := newDoc("h1", "Hook Doc")
	require.NoError(t, svc.Save(ctx, testProjectID, doc))

	doc2 := newDoc("h2", "Parent")
	require.NoError(t, svc.Save(ctx, testProjectID, doc2))
	require.NoError(t, svc.Move(ctx, testProjectID, "h1", "h2", "", ""))

	require.NoError(t, svc.Delete(ctx, testProjectID, "h1"))

	expected := []string{
		"BeforeSave1:Hook Doc", "BeforeSave2:Hook Doc", "AfterSave1:Hook Doc",
		"BeforeSave1:Parent", "BeforeSave2:Parent", "AfterSave1:Parent",
		"BeforeMove1:h1", "AfterMove1:h1",
		"BeforeDelete1:h1", "AfterDelete1:h1",
	}
	assert.Equal(t, expected, callLog)
}
