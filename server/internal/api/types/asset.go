package types

type AssetImportResponse struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Data    AssetImportResult `json:"data"`
}

type AssetImportResult struct {
	AssetID  string `json:"asset_id"`
	Filename string `json:"filename"`
	Mime     string `json:"mime"`
	Size     int64  `json:"size"`
}

type AssetKindResponse struct {
	Code    string        `json:"code"`
	Message string        `json:"message"`
	Data    AssetKindData `json:"data"`
}

type AssetKindData struct {
	Kind           string `json:"kind"`
	OpenAPIVersion string `json:"openapi_version"`
}
