package convert

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"zeus/internal/service"
)

const (
	maxFileSizeBytes = int64(15 * 1024 * 1024)
	convertTimeout   = 20 * time.Second
)

type Service struct {
	converter Converter
}

var _ service.ConvertService = (*Service)(nil)

func NewService(converter Converter) *Service {
	return &Service{converter: converter}
}

func (s *Service) Convert(ctx context.Context, input []byte, from string, to string) (string, error) {
	if s == nil || s.converter == nil {
		return "", errors.New("pandoc not configured")
	}
	if int64(len(input)) > maxFileSizeBytes {
		return "", fmt.Errorf("file too large: %d bytes", len(input))
	}

	from = strings.TrimSpace(strings.ToLower(from))
	to = strings.TrimSpace(strings.ToLower(to))
	if from == "" || to == "" {
		return "", errors.New("from/to is required")
	}
	if from != "docx" || to != "md" {
		return "", errors.New("unsupported conversion")
	}

	ctx, cancel := context.WithTimeout(ctx, convertTimeout)
	defer cancel()

	return s.converter.Convert(ctx, input, from, to)
}

type Converter interface {
	Convert(ctx context.Context, input []byte, from string, to string) (string, error)
}
