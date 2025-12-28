package document

import "context"

type Service interface {
	UploadDocument(ctx context.Context, req UploadRequest) (*UploadResponse, error)
}

type UploadRequest struct {
	BatchID      string
	Title        string
	OriginalPath string
	ContentType  string
	Content      []byte
}

type UploadResponse struct {
	DocID   string `json:"doc_id"`
	BatchID string `json:"batch_id"`
	Status  string `json:"status"`
}
