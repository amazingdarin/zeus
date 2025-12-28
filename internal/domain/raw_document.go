package domain

import (
	"fmt"
	"strings"
)

const (
	docIDPrefix   = "DOC-"
	batchIDPrefix = "batch-"
)

type SourceType string

const (
	SourceTypeUnknown    SourceType = "unknown"
	SourceTypePDF        SourceType = "pdf"
	SourceTypeWord       SourceType = "word"
	SourceTypeMarkdown   SourceType = "markdown"
	SourceTypeWiki       SourceType = "wiki"
	SourceTypeConfluence SourceType = "confluence"
)

func (t SourceType) IsValid() bool {
	switch t {
	case SourceTypeUnknown,
		SourceTypePDF,
		SourceTypeWord,
		SourceTypeMarkdown,
		SourceTypeWiki,
		SourceTypeConfluence:
		return true
	default:
		return false
	}
}

type DocumentCategory string

const (
	CategoryUnknown     DocumentCategory = "unknown"
	CategoryRequirement DocumentCategory = "requirement"
	CategoryAPI         DocumentCategory = "api"
	CategoryDesign      DocumentCategory = "design"
)

func (c DocumentCategory) IsValid() bool {
	switch c {
	case CategoryUnknown,
		CategoryRequirement,
		CategoryAPI,
		CategoryDesign:
		return true
	default:
		return false
	}
}

type DocumentStatus string

const (
	StatusPending    DocumentStatus = "pending"
	StatusClassified DocumentStatus = "classified"
	StatusConfirmed  DocumentStatus = "confirmed"
	StatusRejected   DocumentStatus = "rejected"
)

func (s DocumentStatus) IsValid() bool {
	switch s {
	case StatusPending,
		StatusClassified,
		StatusConfirmed,
		StatusRejected:
		return true
	default:
		return false
	}
}

type RawDocument struct {
	DocID      string
	SourceType SourceType
	SourceURI  string
	Title      string
	Metadata   DocumentMetadata
}

func (d RawDocument) Validate() error {
	if strings.TrimSpace(d.DocID) == "" {
		return fmt.Errorf("doc id is required")
	}
	if !strings.HasPrefix(d.DocID, docIDPrefix) {
		return fmt.Errorf("doc id must start with %s", docIDPrefix)
	}
	if d.SourceType != "" && !d.SourceType.IsValid() {
		return fmt.Errorf("invalid source type: %s", d.SourceType)
	}
	if err := d.Metadata.Validate(); err != nil {
		return fmt.Errorf("metadata invalid: %w", err)
	}
	return nil
}

type DocumentMetadata struct {
	BatchID         string
	OriginalPath    string
	Category        DocumentCategory
	CandidateModule string
	Confidence      float64
	Status          DocumentStatus
}

func (m DocumentMetadata) Validate() error {
	if strings.TrimSpace(m.BatchID) == "" {
		return fmt.Errorf("batch id is required")
	}
	if !strings.HasPrefix(m.BatchID, batchIDPrefix) {
		return fmt.Errorf("batch id must start with %s", batchIDPrefix)
	}
	if strings.TrimSpace(m.OriginalPath) == "" {
		return fmt.Errorf("original path is required")
	}
	if !m.Category.IsValid() {
		return fmt.Errorf("invalid category: %s", m.Category)
	}
	if m.CandidateModule != "" {
		if err := validateModuleName(m.CandidateModule); err != nil {
			return fmt.Errorf("candidate module invalid: %w", err)
		}
		if m.Confidence <= 0 || m.Confidence > 1 {
			return fmt.Errorf("confidence must be in (0,1] when candidate module is set")
		}
	} else if m.Confidence != 0 {
		return fmt.Errorf("confidence must be 0 when candidate module is empty")
	}
	if m.Status != "" && !m.Status.IsValid() {
		return fmt.Errorf("invalid status: %s", m.Status)
	}
	return nil
}

func validateModuleName(name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("module name is required")
	}
	if strings.ContainsAny(name, " \t\n") {
		return fmt.Errorf("module name must not contain whitespace")
	}
	if strings.ToUpper(name) != name {
		return fmt.Errorf("module name must be uppercase")
	}
	return nil
}
