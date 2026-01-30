package types

type SearchResultDTO struct {
	DocID   string `json:"doc_id"`
	Slug    string `json:"slug"`
	Title   string `json:"title"`
	Snippet string `json:"snippet"`
	BlockID string `json:"block_id,omitempty"`
}

type SearchResponse struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Data    []SearchResultDTO `json:"data"`
}
