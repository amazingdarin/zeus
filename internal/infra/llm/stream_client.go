package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"zeus/internal/infra/embedding"
	"zeus/internal/service/chatstream"
)

type StreamClient interface {
	StreamChat(
		ctx context.Context,
		runtime embedding.ModelRuntime,
		messages []chatstream.ChatMessage,
		onDelta func(string) error,
	) error
}

type OpenAIStreamClient struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

func NewOpenAIStreamClient(timeout time.Duration) *OpenAIStreamClient {
	if timeout <= 0 {
		timeout = 3 * time.Minute
	}
	return &OpenAIStreamClient{
		client: &http.Client{Timeout: timeout},
	}
}

func (c *OpenAIStreamClient) StreamChat(
	ctx context.Context,
	runtime embedding.ModelRuntime,
	messages []chatstream.ChatMessage,
	onDelta func(string) error,
) error {
	if onDelta == nil {
		return fmt.Errorf("onDelta is required")
	}
	modelName := strings.TrimSpace(runtime.ModelName)
	if modelName == "" {
		return fmt.Errorf("model_name is required")
	}
	baseURL := strings.TrimSpace(runtime.BaseURL)
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}
	payload := map[string]interface{}{
		"model":    modelName,
		"messages": messages,
		"stream":   true,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal chat payload: %w", err)
	}
	url := withVersion(baseURL, "/chat/completions")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	if runtime.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+runtime.APIKey)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("streaming chat returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return err
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		payload := line
		if strings.HasPrefix(line, "data:") {
			payload = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		}
		if payload == "[DONE]" {
			return nil
		}
		deltas, err := parseStreamChunk(payload)
		if err != nil {
			return err
		}
		for _, delta := range deltas {
			if delta == "" {
				continue
			}
			if err := onDelta(delta); err != nil {
				return err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read stream: %w", err)
	}
	return nil
}

func parseStreamChunk(payload string) ([]string, error) {
	var chunk struct {
		Choices []struct {
			Delta struct {
				Content string `json:"content"`
			} `json:"delta"`
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
		return nil, fmt.Errorf("decode stream chunk: %w", err)
	}
	deltas := make([]string, 0, len(chunk.Choices))
	for _, choice := range chunk.Choices {
		if choice.Delta.Content != "" {
			deltas = append(deltas, choice.Delta.Content)
			continue
		}
		if choice.Message.Content != "" {
			deltas = append(deltas, choice.Message.Content)
		}
	}
	return deltas, nil
}

var _ StreamClient = (*OpenAIStreamClient)(nil)
