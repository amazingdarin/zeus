package s3

import (
	"context"
	"fmt"
	"strings"

	"zeus/internal/infra/ingestion"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type S3FileIngestion struct {
	client *s3.Client
	bucket string
	prefix string // 可选，如 "zeus"
}

func NewS3FileIngestion(
	client *s3.Client,
	bucket string,
	prefix string,
) *S3FileIngestion {
	return &S3FileIngestion{
		client: client,
		bucket: bucket,
		prefix: prefix,
	}
}

func (s *S3FileIngestion) Store(
	ctx context.Context,
	input ingestion.StoreInput,
) (*ingestion.StoredObject, error) {

	// 构造最终 S3 Key
	key := input.ObjectKey
	if s.prefix != "" {
		key = fmt.Sprintf("%s/%s", s.prefix, key)
	}
	if input.Namespace != "" {
		key = fmt.Sprintf("%s/%s", input.Namespace, key)
	}

	putInput := &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        input.Reader,
		ContentType: aws.String(input.ContentType),
	}

	// ⚠️ RustFS / MinIO 通常不要求 ContentLength
	// 如果你希望校验，可以在这里补充

	out, err := s.client.PutObject(ctx, putInput)
	if err != nil {
		return nil, err
	}

	return &ingestion.StoredObject{
		Bucket: s.bucket,
		Key:    key,
		Size:   input.Size,
		ETag:   aws.ToString(out.ETag),
	}, nil
}

func (s *S3FileIngestion) CreateDirectory(
	ctx context.Context,
	input ingestion.DirectoryInput,
) (*ingestion.StoredObject, error) {
	key := strings.TrimSpace(input.Path)
	if key == "" {
		return nil, fmt.Errorf("path is required")
	}
	if !strings.HasSuffix(key, "/") {
		key += "/"
	}
	if s.prefix != "" {
		key = fmt.Sprintf("%s/%s", s.prefix, key)
	}
	if input.Namespace != "" {
		key = fmt.Sprintf("%s/%s", input.Namespace, key)
	}

	putInput := &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        strings.NewReader(""),
		ContentType: aws.String("application/x-directory"),
	}
	out, err := s.client.PutObject(ctx, putInput)
	if err != nil {
		return nil, err
	}

	return &ingestion.StoredObject{
		Bucket: s.bucket,
		Key:    key,
		Size:   0,
		ETag:   aws.ToString(out.ETag),
	}, nil
}
