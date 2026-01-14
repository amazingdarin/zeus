package chatstream

import (
	"context"
	"fmt"
	"strings"
	"time"

	domainrag "zeus/internal/domain/rag"
	"zeus/internal/infra/embedding"
	"zeus/internal/service/chatrun"
)

const chatScenario = "chat"

type ChatEvent struct {
	ID      int64
	Type    string
	Payload any
}

type ChatArtifact struct {
	Type  string         `json:"type"`
	Title string         `json:"title,omitempty"`
	Data  map[string]any `json:"data,omitempty"`
}

type AssistantDonePayload struct {
	Message   string         `json:"message"`
	Artifacts []ChatArtifact `json:"artifacts,omitempty"`
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	ProjectID  string
	ProjectKey string
	Query      string
	Messages   []ChatMessage
	TopK       int
}

type StreamClient interface {
	StreamChat(
		ctx context.Context,
		runtime embedding.ModelRuntime,
		messages []ChatMessage,
		onDelta func(string) error,
	) error
}

type ContextBuilder interface {
	BuildContext(ctx context.Context, query domainrag.RAGQuery) (domainrag.RAGContextBundle, error)
}

// Service runs a single streaming chat generation.
// It is transport-agnostic and can be reused by SSE/WebSocket/MCP.
type Service struct {
	rag      ContextBuilder
	resolver embedding.ModelRuntimeResolver
	streamer StreamClient
	slash    SlashRouter
	proposal ChangeProposalCreator
}

func NewService(
	rag ContextBuilder,
	resolver embedding.ModelRuntimeResolver,
	streamer StreamClient,
	slash SlashRouter,
	proposal ChangeProposalCreator,
) *Service {
	return &Service{
		rag:      rag,
		resolver: resolver,
		streamer: streamer,
		slash:    slash,
		proposal: proposal,
	}
}

func (s *Service) Run(
	ctx context.Context,
	run *chatrun.ChatRun,
	request ChatRequest,
	emit func(ChatEvent) error,
) error {
	if s == nil {
		return fmt.Errorf("chat stream service is required")
	}
	if emit == nil {
		return fmt.Errorf("emit is required")
	}
	if run == nil {
		return fmt.Errorf("run is required")
	}
	if strings.TrimSpace(request.ProjectID) == "" {
		return fmt.Errorf("project id is required")
	}
	if s.rag == nil {
		return fmt.Errorf("rag context builder is required")
	}
	if s.resolver == nil {
		return fmt.Errorf("model runtime resolver is required")
	}
	if s.streamer == nil {
		return fmt.Errorf("stream client is required")
	}

	var eventID int64
	nextEvent := func(eventType string, payload any) ChatEvent {
		eventID++
		return ChatEvent{
			ID:      eventID,
			Type:    eventType,
			Payload: payload,
		}
	}

	if err := emit(nextEvent("run.started", map[string]string{"run_id": run.RunID})); err != nil {
		return err
	}

	query := strings.TrimSpace(request.Query)
	if query == "" {
		if len(request.Messages) > 0 {
			query = strings.TrimSpace(request.Messages[len(request.Messages)-1].Content)
		}
	}
	if query == "" && len(request.Messages) == 0 {
		return fmt.Errorf("message is required")
	}

	var slashResult SlashResult
	if s.slash != nil {
		result, handled, err := s.slash.Handle(ctx, SlashRequest{
			ProjectID:  request.ProjectID,
			ProjectKey: request.ProjectKey,
			Input:      query,
		})
		if err != nil {
			_ = emit(nextEvent("run.error", map[string]string{"error": err.Error()}))
			return err
		}
		if handled {
			slashResult = result
			if result.Mode == SlashCommandOperation {
				return emit(nextEvent("assistant.done", AssistantDonePayload{
					Message:   result.Message,
					Artifacts: result.Artifacts,
				}))
			}
			if result.Mode == SlashCommandPrompt && strings.TrimSpace(result.ExpandedPrompt) != "" {
				query = strings.TrimSpace(result.ExpandedPrompt)
			}
		}
	}
	ragQuery := domainrag.RAGQuery{
		ProjectID: request.ProjectID,
		Text:      query,
		TopK:      request.TopK,
	}
	contextBundle, err := s.rag.BuildContext(ctx, ragQuery)
	if err != nil {
		_ = emit(nextEvent("run.error", map[string]string{"error": err.Error()}))
		return err
	}
	if err := emit(nextEvent("rag.context", map[string]any{
		"items": contextBundle.Items,
	})); err != nil {
		return err
	}

	baseMessages := request.Messages
	if len(baseMessages) == 0 && query != "" {
		baseMessages = []ChatMessage{{Role: "user", Content: query}}
	}
	messages := buildPromptMessages(baseMessages, contextBundle)
	runtime, err := s.resolver.Resolve(ctx, chatScenario)
	if err != nil {
		_ = emit(nextEvent("run.error", map[string]string{"error": err.Error()}))
		return err
	}

	var assistantBuilder strings.Builder
	if err := s.streamer.StreamChat(ctx, runtime, messages, func(delta string) error {
		assistantBuilder.WriteString(delta)
		if err := waitWhilePaused(ctx, run); err != nil {
			return err
		}
		if err := emit(nextEvent("assistant.delta", delta)); err != nil {
			return err
		}
		return nil
	}); err != nil {
		_ = emit(nextEvent("run.error", map[string]string{"error": err.Error()}))
		return err
	}

	artifacts := buildProposalArtifacts(
		ctx,
		s.proposal,
		slashResult,
		request.ProjectKey,
		assistantBuilder.String(),
	)
	return emit(nextEvent("assistant.done", AssistantDonePayload{
		Message:   assistantBuilder.String(),
		Artifacts: artifacts,
	}))
}

func buildPromptMessages(
	messages []ChatMessage,
	context domainrag.RAGContextBundle,
) []ChatMessage {
	if len(context.Items) == 0 {
		return append([]ChatMessage(nil), messages...)
	}
	var builder strings.Builder
	builder.WriteString("Use the following context to answer the question.\n")
	builder.WriteString("If the context is insufficient, say you do not know.\n\n")
	for _, item := range context.Items {
		builder.WriteString("- ")
		builder.WriteString(item.Content)
		builder.WriteString("\n")
	}
	prompt := ChatMessage{
		Role:    "system",
		Content: builder.String(),
	}
	result := make([]ChatMessage, 0, len(messages)+1)
	result = append(result, prompt)
	result = append(result, messages...)
	return result
}

func waitWhilePaused(ctx context.Context, run *chatrun.ChatRun) error {
	for run != nil && run.Status == chatrun.StatusPaused {
		if err := checkCanceled(ctx, run); err != nil {
			return err
		}
		time.Sleep(200 * time.Millisecond)
	}
	return checkCanceled(ctx, run)
}

func checkCanceled(ctx context.Context, run *chatrun.ChatRun) error {
	if ctx != nil {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
	}
	if run != nil && run.Context != nil {
		select {
		case <-run.Context.Done():
			return run.Context.Err()
		default:
		}
	}
	return nil
}
