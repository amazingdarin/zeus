package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"zeus/internal/infra/embedding"
)

type OpenAICompatibleClient struct {
	client *http.Client
}

func NewOpenAICompatibleClient() *OpenAICompatibleClient {
	return &OpenAICompatibleClient{
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *OpenAICompatibleClient) Chat(
	ctx context.Context,
	runtime embedding.ModelRuntime,
	messages []Message,
	maxTokens int,
) (string, error) {
	if strings.TrimSpace(runtime.ModelName) == "" {
		return "", fmt.Errorf("model_name is required")
	}
	if maxTokens <= 0 {
		maxTokens = 256
	}
	payload := map[string]interface{}{
		"model":      runtime.ModelName,
		"messages":   messages,
		"max_tokens": maxTokens,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal chat payload: %w", err)
	}
	url := withVersion(runtime.BaseURL, "/chat/completions")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	if strings.TrimSpace(runtime.APIKey) != "" {
		req.Header.Set("Authorization", "Bearer "+runtime.APIKey)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("chat completion returned status %d", resp.StatusCode)
	}

	var payloadResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payloadResp); err != nil {
		return "", fmt.Errorf("decode chat response: %w", err)
	}
	if len(payloadResp.Choices) == 0 {
		return "", fmt.Errorf("empty chat response")
	}
	content := strings.TrimSpace(payloadResp.Choices[0].Message.Content)
	if content == "" {
		return "", fmt.Errorf("empty summary content")
	}
	return content, nil
}

func withVersion(baseURL, path string) string {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}
	baseURL = strings.TrimRight(baseURL, "/")
	if !strings.HasSuffix(baseURL, "/v1") {
		baseURL += "/v1"
	}
	return baseURL + path
}

var _ Client = (*OpenAICompatibleClient)(nil)
