package modelruntime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type ModelRuntimeClient interface {
	ListModels(ctx context.Context) ([]string, error)
	TestChat(ctx context.Context, model string) error
	TestEmbedding(ctx context.Context, model string) error
}

type ClientFactory func(baseURL, apiKey string) ModelRuntimeClient

type OpenAIClient struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

func NewOpenAIClient(baseURL, apiKey string) *OpenAIClient {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}
	return &OpenAIClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  strings.TrimSpace(apiKey),
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

func DefaultClientFactory(baseURL, apiKey string) ModelRuntimeClient {
	return NewOpenAIClient(baseURL, apiKey)
}

func (c *OpenAIClient) ListModels(ctx context.Context) ([]string, error) {
	url := c.withVersion("/models")
	resp, err := c.doRequest(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("models api returned status %d", resp.StatusCode)
	}

	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode models response: %w", err)
	}

	models := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			continue
		}
		models = append(models, id)
	}
	return models, nil
}

func (c *OpenAIClient) TestChat(ctx context.Context, model string) error {
	if strings.TrimSpace(model) == "" {
		return fmt.Errorf("model_name is required")
	}
	payload := map[string]interface{}{
		"model": model,
		"messages": []map[string]string{
			{"role": "user", "content": "ping"},
		},
		"max_tokens": 1,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal chat payload: %w", err)
	}
	url := c.withVersion("/chat/completions")
	resp, err := c.doRequest(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("chat completion returned status %d", resp.StatusCode)
	}
	return nil
}

func (c *OpenAIClient) TestEmbedding(ctx context.Context, model string) error {
	if strings.TrimSpace(model) == "" {
		return fmt.Errorf("model_name is required")
	}
	payload := map[string]interface{}{
		"model": model,
		"input": "ping",
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal embedding payload: %w", err)
	}
	url := c.withVersion("/embeddings")
	resp, err := c.doRequest(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("embedding returned status %d", resp.StatusCode)
	}
	return nil
}

func (c *OpenAIClient) withVersion(path string) string {
	url := c.baseURL
	if !strings.HasSuffix(url, "/v1") {
		url += "/v1"
	}
	return url + path
}

func (c *OpenAIClient) doRequest(ctx context.Context, method, url string, body *bytes.Reader) (*http.Response, error) {
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		reader = body
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	return resp, nil
}
