package domain

// DocType represents the knowledge document type stored in .meta.json.
// It is a stable enum used for behavior decisions, not presentation.
type DocType string

const (
	DocTypeDocument   DocType = "document"
	DocTypeOverview   DocType = "overview"
	DocTypeSpec       DocType = "spec"
	DocTypeAssetIndex DocType = "asset_index"
	DocTypeOpenAPI    DocType = "openapi"
)
