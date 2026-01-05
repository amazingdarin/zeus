package objectstorage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"zeus/internal/domain"
	"zeus/internal/service"
)

// ObjectStorageAssetStorage stores assets into an S3-compatible backend.
type ObjectStorageAssetStorage struct {
	client *s3.Client
	bucket string
	now    func() time.Time
}

func NewObjectStorageAssetStorage(client *s3.Client, bucket string) *ObjectStorageAssetStorage {
	return &ObjectStorageAssetStorage{
		client: client,
		bucket: strings.TrimSpace(bucket),
		now:    time.Now,
	}
}

func (s *ObjectStorageAssetStorage) Store(
	ctx context.Context,
	projectKey string,
	assetID string,
	filename string,
	content io.Reader,
) (service.StoredAssetInfo, error) {
	if s == nil {
		return service.StoredAssetInfo{}, fmt.Errorf("object storage is required")
	}
	if s.client == nil {
		return service.StoredAssetInfo{}, fmt.Errorf("s3 client is required")
	}
	if strings.TrimSpace(s.bucket) == "" {
		return service.StoredAssetInfo{}, fmt.Errorf("bucket is required")
	}
	projectKey = strings.TrimSpace(projectKey)
	if projectKey == "" {
		return service.StoredAssetInfo{}, fmt.Errorf("project key is required")
	}
	assetID = strings.TrimSpace(assetID)
	if assetID == "" {
		return service.StoredAssetInfo{}, fmt.Errorf("asset id is required")
	}
	if content == nil {
		return service.StoredAssetInfo{}, fmt.Errorf("content is required")
	}

	now := s.nowTime()
	objectKey := fmt.Sprintf(
		"%s/assets/%04d/%02d/%s",
		projectKey,
		now.Year(),
		int(now.Month()),
		assetID,
	)

	mime, reader, counter, err := sniffAndCount(content)
	if err != nil {
		return service.StoredAssetInfo{}, fmt.Errorf("read content: %w", err)
	}

	_, err = s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(objectKey),
		Body:        reader,
		ContentType: aws.String(mime),
	})
	if err != nil {
		return service.StoredAssetInfo{}, fmt.Errorf("put object: %w", err)
	}

	return service.StoredAssetInfo{
		StorageType: domain.AssetStorageTypeObject,
		Size:        counter.n,
		Mime:        mime,
		Bucket:      s.bucket,
		ObjectKey:   objectKey,
	}, nil
}

func (s *ObjectStorageAssetStorage) nowTime() time.Time {
	if s.now == nil {
		return time.Now()
	}
	return s.now()
}

type countWriter struct {
	n int64
}

func (w *countWriter) Write(p []byte) (int, error) {
	w.n += int64(len(p))
	return len(p), nil
}

func sniffAndCount(r io.Reader) (string, io.Reader, *countWriter, error) {
	const sniffSize = 512
	buf := make([]byte, sniffSize)
	n, err := io.ReadFull(r, buf)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return "", nil, nil, err
	}
	sniff := buf[:n]
	mime := http.DetectContentType(sniff)

	counter := &countWriter{}
	reader := io.MultiReader(bytes.NewReader(sniff), r)
	return mime, io.TeeReader(reader, counter), counter, nil
}

var _ service.AssetStorageService = (*ObjectStorageAssetStorage)(nil)
