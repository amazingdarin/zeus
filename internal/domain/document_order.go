package domain

// DocumentOrder stores the order of children under a parent directory.
// It is the single source of truth for sibling ordering in Git.
type DocumentOrder struct {
	Version int      `json:"version"`
	Order   []string `json:"order"`
}
