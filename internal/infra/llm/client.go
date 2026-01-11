package llm

import (
	"context"

	"zeus/internal/infra/embedding"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Client defines a minimal chat-completion interface for summary generation.
type Client interface {
	Chat(
		ctx context.Context,
		runtime embedding.ModelRuntime,
		messages []Message,
		maxTokens int,
	) (string, error)
}
