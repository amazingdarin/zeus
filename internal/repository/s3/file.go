package s3

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awss3 "github.com/aws/aws-sdk-go-v2/service/s3"

	"zeus/internal/repository"
)

type FileRepository struct {
	client *awss3.Client
	bucket string
}

func NewFileRepository(client *awss3.Client, bucket string) (*FileRepository, error) {
	if client == nil {
		return nil, fmt.Errorf("s3 client is required")
	}
	bucket = strings.TrimSpace(bucket)
	if bucket == "" {
		return nil, fmt.Errorf("bucket is required")
	}
	return &FileRepository{
		client: client,
		bucket: bucket,
	}, nil
}

func (r *FileRepository) Upload(
	ctx context.Context,
	key string,
	body io.Reader,
	size int64,
	contentType string,
) (string, error) {
	if r == nil || r.client == nil {
		return "", fmt.Errorf("repository not initialized")
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return "", fmt.Errorf("object key is required")
	}
	if body == nil {
		return "", fmt.Errorf("body is required")
	}

	input := &awss3.PutObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
		Body:   body,
	}
	if size > 0 {
		input.ContentLength = aws.Int64(size)
	}
	if contentType = strings.TrimSpace(contentType); contentType != "" {
		input.ContentType = aws.String(contentType)
	}

	if _, err := r.client.PutObject(ctx, input); err != nil {
		return "", fmt.Errorf("put object: %w", err)
	}

	return fmt.Sprintf("s3://%s/%s", r.bucket, key), nil
}

var _ repository.FileRepository = (*FileRepository)(nil)
