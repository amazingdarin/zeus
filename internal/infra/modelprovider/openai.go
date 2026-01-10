package modelprovider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type OpenAIProvider struct {
	baseURL   string
	accessKey string
	client    *http.Client
}

func NewOpenAIProvider(baseURL, accessKey string) *OpenAIProvider {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	return &OpenAIProvider{
		baseURL:   strings.TrimRight(baseURL, "/"),
		accessKey: strings.TrimSpace(accessKey),
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

func (p *OpenAIProvider) ListModels(ctx context.Context) ([]ModelInfo, error) {
	if strings.TrimSpace(p.accessKey) == "" {
		return nil, fmt.Errorf("access key is required")
	}
	url := p.baseURL
	if !strings.HasSuffix(url, "/v1") {
		url += "/v1"
	}
	url += "/models"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+p.accessKey)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request models: %w", err)
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
		return nil, fmt.Errorf("decode response: %w", err)
	}

	items := make([]ModelInfo, 0, len(payload.Data))
	for _, item := range payload.Data {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			continue
		}
		items = append(items, ModelInfo{ID: id, Name: id})
	}
	return items, nil
}
