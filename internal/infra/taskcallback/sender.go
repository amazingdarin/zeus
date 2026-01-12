package taskcallback

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"zeus/internal/domain"
)

type Sender interface {
	Send(ctx context.Context, task domain.Task, status string, result map[string]interface{}, errorMessage string) error
}

type HTTPSender struct {
	client *http.Client
}

func NewHTTPSender() *HTTPSender {
	return &HTTPSender{
		client: &http.Client{Timeout: 20 * time.Second},
	}
}

func (s *HTTPSender) Send(
	ctx context.Context,
	task domain.Task,
	status string,
	result map[string]interface{},
	errorMessage string,
) error {
	url := strings.TrimSpace(task.CallbackURL)
	if url == "" {
		return nil
	}
	payload := map[string]interface{}{
		"task_id": task.ID,
		"type":    task.Type,
		"status":  status,
		"result":  result,
		"error":   errorMessage,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal callback payload: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("build callback request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if task.CallbackSecret != "" {
		sig := signPayload(task.CallbackSecret, data)
		req.Header.Set("X-Zeus-Signature", sig)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("callback request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("callback returned status %d", resp.StatusCode)
	}
	return nil
}

func signPayload(secret string, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

var _ Sender = (*HTTPSender)(nil)
