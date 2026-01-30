package assetcontent

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"zeus/internal/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"zeus/internal/domain"
	documentservice "zeus/internal/modules/document/service"
)

type Reader struct {
	s3 *s3.Client
}

func NewReader(s3Client *s3.Client) *Reader {
	return &Reader{s3: s3Client}
}

func (r *Reader) ReadHead(
	ctx context.Context,
	meta documentservice.AssetMeta,
	maxBytes int64,
) ([]byte, error) {
	if r == nil {
		return nil, fmt.Errorf("asset reader is required")
	}
	if maxBytes <= 0 {
		return nil, fmt.Errorf("max bytes must be positive")
	}

	switch meta.StorageType {
	case domain.AssetStorageTypeGit:
		projectKey := strings.TrimSpace(meta.ProjectKey)
		if projectKey == "" {
			return nil, fmt.Errorf("project key is required")
		}
		gitTempDir := filepath.Join(config.AppConfig.Asset.MetaRoot, projectKey, meta.GitTempPath)
		return readHeadFromFile(gitTempDir, maxBytes)
	case domain.AssetStorageTypeObject:
		return r.readHeadFromObject(ctx, meta, maxBytes)
	default:
		return nil, fmt.Errorf("unsupported storage type: %s", meta.StorageType)
	}
}

func (r *Reader) ReadAll(ctx context.Context, meta documentservice.AssetMeta) ([]byte, error) {
	if r == nil {
		return nil, fmt.Errorf("asset reader is required")
	}
	switch meta.StorageType {
	case domain.AssetStorageTypeGit:
		projectKey := strings.TrimSpace(meta.ProjectKey)
		if projectKey == "" {
			return nil, fmt.Errorf("project key is required")
		}
		gitTempDir := filepath.Join(config.AppConfig.Asset.MetaRoot, projectKey, meta.GitTempPath)
		return readAllFromFile(gitTempDir)
	case domain.AssetStorageTypeObject:
		return r.readAllFromObject(ctx, meta)
	default:
		return nil, fmt.Errorf("unsupported storage type: %s", meta.StorageType)
	}
}

func readHeadFromFile(path string, maxBytes int64) ([]byte, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, fmt.Errorf("asset path is required")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open asset file: %w", err)
	}
	defer file.Close()

	buf := make([]byte, maxBytes)
	n, err := file.Read(buf)
	if err != nil && err != io.EOF {
		return nil, fmt.Errorf("read asset file: %w", err)
	}
	return buf[:n], nil
}

func readAllFromFile(path string) ([]byte, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, fmt.Errorf("asset path is required")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read asset file: %w", err)
	}
	return data, nil
}

func (r *Reader) readHeadFromObject(
	ctx context.Context,
	meta documentservice.AssetMeta,
	maxBytes int64,
) ([]byte, error) {
	if r.s3 == nil {
		return nil, fmt.Errorf("s3 client is required")
	}
	if strings.TrimSpace(meta.Bucket) == "" || strings.TrimSpace(meta.ObjectKey) == "" {
		return nil, fmt.Errorf("bucket and object key are required")
	}
	rangeHeader := fmt.Sprintf("bytes=0-%d", maxBytes-1)
	output, err := r.s3.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(meta.Bucket),
		Key:    aws.String(meta.ObjectKey),
		Range:  aws.String(rangeHeader),
	})
	if err != nil {
		return nil, fmt.Errorf("get object: %w", err)
	}
	defer output.Body.Close()

	data, err := io.ReadAll(output.Body)
	if err != nil {
		return nil, fmt.Errorf("read object body: %w", err)
	}
	return data, nil
}

func (r *Reader) readAllFromObject(
	ctx context.Context,
	meta documentservice.AssetMeta,
) ([]byte, error) {
	if r.s3 == nil {
		return nil, fmt.Errorf("s3 client is required")
	}
	if strings.TrimSpace(meta.Bucket) == "" || strings.TrimSpace(meta.ObjectKey) == "" {
		return nil, fmt.Errorf("bucket and object key are required")
	}
	output, err := r.s3.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(meta.Bucket),
		Key:    aws.String(meta.ObjectKey),
	})
	if err != nil {
		return nil, fmt.Errorf("get object: %w", err)
	}
	defer output.Body.Close()

	data, err := io.ReadAll(output.Body)
	if err != nil {
		return nil, fmt.Errorf("read object body: %w", err)
	}
	return data, nil
}

var _ documentservice.AssetContentReader = (*Reader)(nil)
