package httpfetch

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	defaultTimeout   = 10 * time.Second
	defaultMaxBytes  = int64(2 * 1024 * 1024)
	defaultUserAgent = "ZeusBot/1.0"
)

var (
	ErrInvalidURL      = errors.New("invalid url")
	ErrFetchFailed     = errors.New("fetch failed")
	ErrFetchTimeout    = errors.New("fetch timeout")
	ErrPayloadTooLarge = errors.New("payload too large")
)

type FetcherConfig struct {
	Timeout   time.Duration
	MaxBytes  int64
	UserAgent string
}

type Fetcher struct {
	client    *http.Client
	maxBytes  int64
	userAgent string
}

type Result struct {
	URL       string
	HTML      []byte
	FetchedAt time.Time
}

func NewFetcher(config FetcherConfig) *Fetcher {
	timeout := config.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	maxBytes := config.MaxBytes
	if maxBytes <= 0 {
		maxBytes = defaultMaxBytes
	}
	userAgent := strings.TrimSpace(config.UserAgent)
	if userAgent == "" {
		userAgent = defaultUserAgent
	}
	return &Fetcher{
		client: &http.Client{
			Timeout: timeout,
		},
		maxBytes:  maxBytes,
		userAgent: userAgent,
	}
}

func (f *Fetcher) Fetch(ctx context.Context, rawURL string) (*Result, error) {
	parsed, err := parseURL(rawURL)
	if err != nil {
		return nil, ErrInvalidURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, ErrFetchFailed
	}
	req.Header.Set("User-Agent", f.userAgent)
	resp, err := f.client.Do(req)
	if err != nil {
		if isTimeout(err) {
			return nil, ErrFetchTimeout
		}
		return nil, ErrFetchFailed
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, ErrFetchFailed
	}

	reader := io.LimitReader(resp.Body, f.maxBytes+1)
	data, err := io.ReadAll(reader)
	if err != nil {
		if isTimeout(err) {
			return nil, ErrFetchTimeout
		}
		return nil, ErrFetchFailed
	}
	if int64(len(data)) > f.maxBytes {
		return nil, ErrPayloadTooLarge
	}

	return &Result{
		URL:       resp.Request.URL.String(),
		HTML:      data,
		FetchedAt: time.Now().UTC(),
	}, nil
}

func parseURL(raw string) (*url.URL, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, ErrInvalidURL
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, ErrInvalidURL
	}
	if parsed.Host == "" {
		return nil, ErrInvalidURL
	}
	return parsed, nil
}

func isTimeout(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	if netErr, ok := err.(net.Error); ok {
		return netErr.Timeout()
	}
	return false
}
