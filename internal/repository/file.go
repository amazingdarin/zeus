package repository

import (
	"context"
	"io"
)

type FileRepository interface {
	Upload(ctx context.Context, key string, body io.Reader, size int64, contentType string) (string, error)
}
