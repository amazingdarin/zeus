package domain

type SemanticItem struct {
	ItemID       string
	ProjectID    string
	DocumentID   string
	DocumentPath string

	BlockType   string
	HeadingPath []string
	Text        string
	Order       int
}
