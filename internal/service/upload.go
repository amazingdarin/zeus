package service

import (
	"context"
	"mime/multipart"
)

type UploadService interface {
	CreateBatch(
		ctx context.Context,
		sourceType string,
		description string,
	) (batchID string, uploadURL string, err error)

	UploadFile(
		ctx context.Context,
		batchID string,
		file *multipart.FileHeader,
		relativePath string,
	) error
}
