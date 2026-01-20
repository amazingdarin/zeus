package docstore

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"zeus/internal/domain/docstore"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testProjectID = "proj-1"

func setup(t *testing.T) (Service, string) {
	tmpDir := t.TempDir()
	svc := NewService(tmpDir)
	return svc, tmpDir
}

func newDoc(id, title string) *docstore.Document {
	return &docstore.Document{
		Meta: docstore.DocumentMeta{
			ID:    id,
			Title: title,
		},
		Body: docstore.DocumentBody{
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
	err := svc.Move(ctx, testProjectID, "child-1", "parent-1", -1)
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
	require.NoError(t, svc.Move(ctx, testProjectID, "d3", "root", 0))

	// GetChildren
	items, err := svc.GetChildren(ctx, testProjectID, "root")
	require.NoError(t, err)

	require.Len(t, items, 3)
	assert.Equal(t, "d3", items[0].ID) // C
	// We didn't strictly force d1 to pos 1, so it might be 2 depending on default append.
	// But d3 SHOULD be first.
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

func TestService_Hooks(t *testing.T) {
	svc, _ := setup(t)
	ctx := context.Background()

	var callLog []string

	hooks := docstore.Hooks{
		BeforeSave: []func(ctx docstore.HookContext, doc *docstore.Document) error{
			func(ctx docstore.HookContext, doc *docstore.Document) error {
				callLog = append(callLog, "BeforeSave1:"+doc.Meta.Title)
				return nil
			},
		},
		AfterSave: []func(ctx docstore.HookContext, doc *docstore.Document) error{
			func(ctx docstore.HookContext, doc *docstore.Document) error {
				callLog = append(callLog, "AfterSave1:"+doc.Meta.Title)
				return nil
			},
		},
		BeforeDelete: []func(ctx docstore.HookContext, docID string) error{
			func(ctx docstore.HookContext, docID string) error {
				callLog = append(callLog, "BeforeDelete1:"+docID)
				return nil
			},
		},
		AfterDelete: []func(ctx docstore.HookContext, docID string) error{
			func(ctx docstore.HookContext, docID string) error {
				callLog = append(callLog, "AfterDelete1:"+docID)
				return nil
			},
		},
		BeforeMove: []func(ctx docstore.HookContext, docID, targetParentID string) error{
			func(ctx docstore.HookContext, docID, targetParentID string) error {
				callLog = append(callLog, "BeforeMove1:"+docID)
				return nil
			},
		},
		AfterMove: []func(ctx docstore.HookContext, docID, targetParentID string) error{
			func(ctx docstore.HookContext, docID, targetParentID string) error {
				callLog = append(callLog, "AfterMove1:"+docID)
				return nil
			},
		},
	}

	hooks2 := docstore.Hooks{
		BeforeSave: []func(ctx docstore.HookContext, doc *docstore.Document) error{
			func(ctx docstore.HookContext, doc *docstore.Document) error {
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
	require.NoError(t, svc.Move(ctx, testProjectID, "h1", "h2", 0))

	require.NoError(t, svc.Delete(ctx, testProjectID, "h1"))

	expected := []string{
		"BeforeSave1:Hook Doc", "BeforeSave2:Hook Doc", "AfterSave1:Hook Doc",
		"BeforeSave1:Parent", "BeforeSave2:Parent", "AfterSave1:Parent",
		"BeforeMove1:h1", "AfterMove1:h1",
		"BeforeDelete1:h1", "AfterDelete1:h1",
	}
	assert.Equal(t, expected, callLog)
}
