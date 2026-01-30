package embedding

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// OpenAICompatibleEmbedder calls an OpenAI-compatible embeddings API using runtime config.
type OpenAICompatibleEmbedder struct {
	resolver ModelRuntimeResolver
	client   *http.Client
}

func NewOpenAICompatibleEmbedder(resolver ModelRuntimeResolver) *OpenAICompatibleEmbedder {
	return &OpenAICompatibleEmbedder{
		resolver: resolver,
		client: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

func (e *OpenAICompatibleEmbedder) Embed(ctx context.Context, inputs []string) ([][]float32, error) {
	if len(inputs) == 0 {
		return [][]float32{}, nil
	}
	runtime, err := e.resolver.Resolve(ctx, "embedding")
	if err != nil {
		return nil, err
	}
	model := strings.TrimSpace(runtime.ModelName)
	if model == "" {
		return nil, fmt.Errorf("embedding model_name is required")
	}
	payload := map[string]interface{}{
		"model": model,
		"input": inputs,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal embedding payload: %w", err)
	}
	url := buildURL(runtime.BaseURL, "/v1/embeddings")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(runtime.APIKey) != "" {
		req.Header.Set("Authorization", "Bearer "+runtime.APIKey)
	}
	resp, err := e.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request embeddings: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("embeddings api returned status %d", resp.StatusCode)
	}
	var payloadResp struct {
		Data []struct {
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payloadResp); err != nil {
		return nil, fmt.Errorf("decode embeddings response: %w", err)
	}
	vectors := make([][]float32, 0, len(payloadResp.Data))
	for _, item := range payloadResp.Data {
		vec := make([]float32, len(item.Embedding))
		for i, value := range item.Embedding {
			vec[i] = float32(value)
		}
		vectors = append(vectors, vec)
	}
	return vectors, nil
}

func buildURL(baseURL, path string) string {
	base := strings.TrimSpace(baseURL)
	if base == "" {
		base = "https://api.openai.com"
	}
	base = strings.TrimRight(base, "/")
	return base + path
}
