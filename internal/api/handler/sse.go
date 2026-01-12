package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"zeus/internal/service/chatstream"
)

// PrepareSSE sets headers required by Server-Sent Events.
func PrepareSSE(w http.ResponseWriter) {
	if w == nil {
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
}

// WriteEvent writes a single SSE event with id/event/data payload and flushes.
func WriteEvent(w http.ResponseWriter, event chatstream.ChatEvent) error {
	if w == nil {
		return fmt.Errorf("writer is required")
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		return fmt.Errorf("writer does not support flush")
	}
	data, err := json.Marshal(event.Payload)
	if err != nil {
		return fmt.Errorf("marshal event payload: %w", err)
	}
	if _, err := fmt.Fprintf(w, "id: %d\n", event.ID); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: %s\n", event.Type); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}

// Heartbeat writes keep-alive comments until the context is canceled.
func Heartbeat(ctx context.Context, w http.ResponseWriter, interval time.Duration) error {
	if w == nil {
		return fmt.Errorf("writer is required")
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		return fmt.Errorf("writer does not support flush")
	}
	if interval <= 0 {
		interval = 15 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if _, err := fmt.Fprint(w, ": heartbeat\n\n"); err != nil {
				return err
			}
			flusher.Flush()
		}
	}
}
