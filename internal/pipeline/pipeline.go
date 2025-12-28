package pipeline

import (
	"fmt"
	"path/filepath"
	"strings"

	"zeus/internal/domain/document"
)

// DocumentInput is the in-memory payload for pipeline processing.
type DocumentInput struct {
	DocID        string
	BatchID      string
	OriginalPath string
	SourceURI    string
	Title        string
	SourceType   document.SourceType
	Content      []byte
}

// DocumentContext carries the evolving document state through steps.
type DocumentContext struct {
	Input    DocumentInput
	Document document.RawDocument
}

// NewDocumentContext builds a context with baseline metadata.
func NewDocumentContext(input DocumentInput) *DocumentContext {
	return &DocumentContext{
		Input: input,
		Document: document.RawDocument{
			DocID:      input.DocID,
			SourceType: input.SourceType,
			SourceURI:  input.SourceURI,
			Title:      input.Title,
			Metadata: document.DocumentMetadata{
				BatchID:      input.BatchID,
				OriginalPath: input.OriginalPath,
				Category:     document.CategoryUnknown,
				Status:       document.StatusPending,
			},
		},
	}
}

// Step is a single, independent pipeline unit.
type Step interface {
	Name() string
	Execute(ctx *DocumentContext) error
}

// Pipeline executes steps in order.
type Pipeline struct {
	steps []Step
}

func NewPipeline(steps ...Step) *Pipeline {
	return &Pipeline{steps: steps}
}

func (p *Pipeline) Run(ctx *DocumentContext) error {
	if ctx == nil {
		return fmt.Errorf("context is nil")
	}
	for _, step := range p.steps {
		if step == nil {
			return fmt.Errorf("nil step in pipeline")
		}
		if err := step.Execute(ctx); err != nil {
			return fmt.Errorf("%s failed: %w", step.Name(), err)
		}
	}
	return nil
}

// ExtractMetadataStep fills basic metadata without IO.
type ExtractMetadataStep struct{}

func NewExtractMetadataStep() ExtractMetadataStep {
	return ExtractMetadataStep{}
}

func (s ExtractMetadataStep) Name() string {
	return "ExtractMetadata"
}

func (s ExtractMetadataStep) Execute(ctx *DocumentContext) error {
	if ctx == nil {
		return fmt.Errorf("context is nil")
	}

	if strings.TrimSpace(ctx.Document.DocID) == "" {
		ctx.Document.DocID = strings.TrimSpace(ctx.Input.DocID)
	}

	if ctx.Document.SourceType == "" {
		ctx.Document.SourceType = detectSourceType(ctx.Input.OriginalPath)
	}

	if ctx.Document.SourceURI == "" {
		ctx.Document.SourceURI = strings.TrimSpace(ctx.Input.SourceURI)
	}

	if strings.TrimSpace(ctx.Document.Title) == "" {
		ctx.Document.Title = deriveTitle(ctx.Input.Title, ctx.Input.OriginalPath)
	}

	if strings.TrimSpace(ctx.Document.Metadata.BatchID) == "" {
		ctx.Document.Metadata.BatchID = strings.TrimSpace(ctx.Input.BatchID)
	}

	if strings.TrimSpace(ctx.Document.Metadata.OriginalPath) == "" {
		ctx.Document.Metadata.OriginalPath = strings.TrimSpace(ctx.Input.OriginalPath)
	}

	if ctx.Document.Metadata.Status == "" {
		ctx.Document.Metadata.Status = document.StatusPending
	}

	if strings.TrimSpace(ctx.Document.DocID) == "" {
		return fmt.Errorf("doc id is required")
	}
	if strings.TrimSpace(ctx.Document.Metadata.BatchID) == "" {
		return fmt.Errorf("batch id is required")
	}
	if strings.TrimSpace(ctx.Document.Metadata.OriginalPath) == "" {
		return fmt.Errorf("original path is required")
	}
	return nil
}

// ClassifyDocumentStep applies rule-based document classification.
type ClassifyDocumentStep struct {
	Rules []ClassificationRule
}

type ClassificationRule struct {
	Keyword  string
	Category document.DocumentCategory
}

func NewClassifyDocumentStep(rules []ClassificationRule) ClassifyDocumentStep {
	if len(rules) == 0 {
		rules = defaultClassificationRules()
	}
	return ClassifyDocumentStep{Rules: rules}
}

func (s ClassifyDocumentStep) Name() string {
	return "ClassifyDocument"
}

func (s ClassifyDocumentStep) Execute(ctx *DocumentContext) error {
	if ctx == nil {
		return fmt.Errorf("context is nil")
	}
	text := combinedText(ctx)
	for _, rule := range s.Rules {
		keyword := strings.ToLower(strings.TrimSpace(rule.Keyword))
		if keyword == "" {
			continue
		}
		if strings.Contains(text, keyword) {
			ctx.Document.Metadata.Category = rule.Category
			ctx.Document.Metadata.Status = document.StatusClassified
			return nil
		}
	}
	ctx.Document.Metadata.Category = document.CategoryUnknown
	ctx.Document.Metadata.Status = document.StatusClassified
	return nil
}

// GuessModuleStep infers a candidate module from rule matches.
type GuessModuleStep struct {
	Rules []ModuleRule
}

type ModuleRule struct {
	Keyword    string
	Module     string
	Confidence float64
}

func NewGuessModuleStep(rules []ModuleRule) GuessModuleStep {
	if len(rules) == 0 {
		rules = defaultModuleRules()
	}
	return GuessModuleStep{Rules: rules}
}

func (s GuessModuleStep) Name() string {
	return "GuessModule"
}

func (s GuessModuleStep) Execute(ctx *DocumentContext) error {
	if ctx == nil {
		return fmt.Errorf("context is nil")
	}
	if strings.TrimSpace(ctx.Document.Metadata.CandidateModule) != "" {
		return nil
	}

	text := combinedText(ctx)
	var (
		bestModule     string
		bestConfidence float64
	)

	for _, rule := range s.Rules {
		keyword := strings.ToLower(strings.TrimSpace(rule.Keyword))
		if keyword == "" {
			continue
		}
		if !strings.Contains(text, keyword) {
			continue
		}
		module := strings.ToUpper(strings.TrimSpace(rule.Module))
		if module == "" {
			continue
		}
		confidence := rule.Confidence
		if confidence <= 0 || confidence > 1 {
			return fmt.Errorf("invalid confidence for module %s", module)
		}
		if confidence > bestConfidence {
			bestModule = module
			bestConfidence = confidence
		}
	}

	if bestModule != "" {
		ctx.Document.Metadata.CandidateModule = bestModule
		ctx.Document.Metadata.Confidence = bestConfidence
	}
	return nil
}

func combinedText(ctx *DocumentContext) string {
	var parts []string
	if ctx.Document.Title != "" {
		parts = append(parts, ctx.Document.Title)
	}
	if ctx.Document.Metadata.OriginalPath != "" {
		parts = append(parts, ctx.Document.Metadata.OriginalPath)
	}
	if len(ctx.Input.Content) > 0 {
		parts = append(parts, string(ctx.Input.Content))
	}
	return strings.ToLower(strings.Join(parts, " "))
}

func deriveTitle(title string, path string) string {
	title = strings.TrimSpace(title)
	if title != "" {
		return title
	}
	base := filepath.Base(strings.TrimSpace(path))
	if base == "." || base == "/" {
		return ""
	}
	ext := filepath.Ext(base)
	if ext != "" {
		base = strings.TrimSuffix(base, ext)
	}
	return strings.TrimSpace(base)
}

func detectSourceType(path string) document.SourceType {
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(path)))
	switch ext {
	case ".pdf":
		return document.SourceTypePDF
	case ".doc", ".docx":
		return document.SourceTypeWord
	case ".md", ".markdown":
		return document.SourceTypeMarkdown
	case ".wiki":
		return document.SourceTypeWiki
	default:
		return document.SourceTypeUnknown
	}
}

func defaultClassificationRules() []ClassificationRule {
	return []ClassificationRule{
		{Keyword: "api", Category: document.CategoryAPI},
		{Keyword: "接口", Category: document.CategoryAPI},
		{Keyword: "endpoint", Category: document.CategoryAPI},
		{Keyword: "requirement", Category: document.CategoryRequirement},
		{Keyword: "需求", Category: document.CategoryRequirement},
		{Keyword: "user story", Category: document.CategoryRequirement},
		{Keyword: "design", Category: document.CategoryDesign},
		{Keyword: "ui", Category: document.CategoryDesign},
		{Keyword: "架构", Category: document.CategoryDesign},
	}
}

func defaultModuleRules() []ModuleRule {
	return []ModuleRule{
		{Keyword: "auth", Module: "AUTH", Confidence: 0.8},
		{Keyword: "login", Module: "AUTH", Confidence: 0.7},
		{Keyword: "user", Module: "USER", Confidence: 0.6},
		{Keyword: "order", Module: "ORDER", Confidence: 0.7},
		{Keyword: "payment", Module: "PAYMENT", Confidence: 0.7},
	}
}
