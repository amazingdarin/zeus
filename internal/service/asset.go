package service

import (
	"context"
	"io"
)

type AssetService interface {
	ImportFile(
		ctx context.Context,
		projectKey string,
		filename string,
		mime string,
		size int64,
		content io.Reader,
	) (assetID string, err error)
}
