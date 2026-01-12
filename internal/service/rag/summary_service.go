package rag

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	domainrag "zeus/internal/domain/rag"
	"zeus/internal/infra/embedding"
	"zeus/internal/infra/llm"
	"zeus/internal/repository"
	"zeus/internal/repository/ragsummary"
)

const (
	summaryScenario   = "chat"
	maxSummaryUnits   = 24
	maxSummaryChars   = 12000
	summaryMaxTokens  = 300
	summaryPromptRole = "system"
)

// SummaryService generates document-level summaries as derived data.
// Summaries never write back to Git and can be deleted/rebuilt anytime.
type SummaryService struct {
	reader    repository.DocumentReader
	extractor RAGExtractor
	repo      ragsummary.DocumentSummaryRepository
	llm       llm.Client
	runtime   embedding.ModelRuntimeResolver
}

func NewSummaryService(
	reader repository.DocumentReader,
	extractor RAGExtractor,
	repo ragsummary.DocumentSummaryRepository,
	llmClient llm.Client,
	runtime embedding.ModelRuntimeResolver,
) *SummaryService {
	return &SummaryService{
		reader:    reader,
		extractor: extractor,
		repo:      repo,
		llm:       llmClient,
		runtime:   runtime,
	}
}

func (s *SummaryService) GenerateDocumentSummary(
	ctx context.Context,
	projectID string,
	docID string,
) (*domainrag.DocumentSummary, error) {
	projectID = strings.TrimSpace(projectID)
	docID = strings.TrimSpace(docID)
	if projectID == "" {
		return nil, fmt.Errorf("project id is required")
	}
	if docID == "" {
		return nil, fmt.Errorf("doc id is required")
	}

	doc, err := s.reader.ReadDocument(ctx, projectID, docID)
	if err != nil {
		return nil, fmt.Errorf("read document: %w", err)
	}
	units, err := s.extractor.Extract(ctx, doc)
	if err != nil {
		return nil, fmt.Errorf("extract rag units: %w", err)
	}
	input := buildSummaryInput(units)
	if strings.TrimSpace(input) == "" {
		return nil, fmt.Errorf("document has no summary content")
	}
	contentHash := hashSummaryContent(input)

	existing, ok, err := s.repo.Get(ctx, projectID, docID)
	if err != nil {
		return nil, fmt.Errorf("get summary: %w", err)
	}
	if ok && existing.ContentHash == contentHash {
		return existing, nil
	}

	runtime, err := s.runtime.Resolve(ctx, summaryScenario)
	if err != nil {
		return nil, fmt.Errorf("resolve runtime: %w", err)
	}

	messages := []llm.Message{
		{
			Role:    summaryPromptRole,
			Content: summarySystemPrompt,
		},
		{
			Role:    "user",
			Content: buildSummaryUserPrompt(input),
		},
	}
	summaryText, err := s.llm.Chat(ctx, runtime, messages, summaryMaxTokens)
	if err != nil {
		return nil, fmt.Errorf("generate summary: %w", err)
	}
	summaryText = strings.TrimSpace(summaryText)
	if summaryText == "" {
		return nil, fmt.Errorf("empty summary")
	}

	now := time.Now().UTC()
	summaryID := uuid.NewString()
	createdAt := now
	if ok && existing != nil {
		summaryID = existing.ID
		createdAt = existing.CreatedAt
	}
	summary := &domainrag.DocumentSummary{
		ID:          summaryID,
		ProjectID:   projectID,
		DocID:       docID,
		SummaryText: summaryText,
		ContentHash: contentHash,
		ModelRef:    strings.TrimSpace(runtime.ID),
		CreatedAt:   createdAt,
		UpdatedAt:   now,
	}
	if err := s.repo.Upsert(ctx, summary); err != nil {
		return nil, fmt.Errorf("save summary: %w", err)
	}
	return summary, nil
}

func (s *SummaryService) GetDocumentSummary(
	ctx context.Context,
	projectID string,
	docID string,
) (*domainrag.DocumentSummary, bool, error) {
	projectID = strings.TrimSpace(projectID)
	docID = strings.TrimSpace(docID)
	if projectID == "" {
		return nil, false, fmt.Errorf("project id is required")
	}
	if docID == "" {
		return nil, false, fmt.Errorf("doc id is required")
	}
	return s.repo.Get(ctx, projectID, docID)
}

func (s *SummaryService) GenerateProjectSummaries(
	ctx context.Context,
	projectID string,
) (int, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return 0, fmt.Errorf("project id is required")
	}
	refs, err := s.reader.ListDocuments(ctx, projectID)
	if err != nil {
		return 0, fmt.Errorf("list documents: %w", err)
	}
	success := 0
	var firstErr error
	failures := 0
	for _, ref := range refs {
		_, err := s.GenerateDocumentSummary(ctx, projectID, ref.DocID)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			failures++
			continue
		}
		success++
	}
	if failures > 0 {
		return success, fmt.Errorf("summary failed for %d documents: %w", failures, firstErr)
	}
	return success, nil
}

func buildSummaryInput(units []domainrag.RAGUnit) string {
	if len(units) == 0 {
		return ""
	}
	var builder strings.Builder
	charCount := 0
	added := 0
	for _, unit := range units {
		if added >= maxSummaryUnits {
			break
		}
		text := strings.TrimSpace(unit.Content)
		if text == "" {
			continue
		}
		runes := []rune(text)
		if charCount+len(runes) > maxSummaryChars {
			remaining := maxSummaryChars - charCount
			if remaining <= 0 {
				break
			}
			text = string(runes[:remaining])
			builder.WriteString(text)
			builder.WriteString("\n")
			charCount += len([]rune(text))
			added++
			break
		}
		builder.WriteString(text)
		builder.WriteString("\n")
		charCount += len(runes)
		added++
	}
	return strings.TrimSpace(builder.String())
}

func hashSummaryContent(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

const summarySystemPrompt = "You are an assistant that summarizes technical documentation.\n" +
	"Produce a concise, neutral summary suitable for a knowledge base."

func buildSummaryUserPrompt(content string) string {
	return fmt.Sprintf("Summarize the following document:\n\n<document>\n%s\n</document>", content)
}
