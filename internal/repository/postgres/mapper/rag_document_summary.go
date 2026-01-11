package mapper

import (
	domainrag "zeus/internal/domain/rag"
	"zeus/internal/repository/postgres/model"
)

func DocumentSummaryFromDomain(summary *domainrag.DocumentSummary) *model.DocumentSummary {
	if summary == nil {
		return nil
	}
	return &model.DocumentSummary{
		ID:          summary.ID,
		ProjectID:   summary.ProjectID,
		DocID:       summary.DocID,
		SummaryText: summary.SummaryText,
		ContentHash: summary.ContentHash,
		ModelRef:    summary.ModelRef,
		CreatedAt:   summary.CreatedAt,
		UpdatedAt:   summary.UpdatedAt,
	}
}

func DocumentSummaryToDomain(summary *model.DocumentSummary) *domainrag.DocumentSummary {
	if summary == nil {
		return nil
	}
	return &domainrag.DocumentSummary{
		ID:          summary.ID,
		ProjectID:   summary.ProjectID,
		DocID:       summary.DocID,
		SummaryText: summary.SummaryText,
		ContentHash: summary.ContentHash,
		ModelRef:    summary.ModelRef,
		CreatedAt:   summary.CreatedAt,
		UpdatedAt:   summary.UpdatedAt,
	}
}
