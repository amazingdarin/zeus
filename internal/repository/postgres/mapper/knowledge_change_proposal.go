package mapper

import (
	"encoding/json"

	"gorm.io/datatypes"

	"zeus/internal/domain"
	"zeus/internal/repository/postgres/model"
)

func KnowledgeChangeProposalFromDomain(proposal *domain.KnowledgeChangeProposal) *model.KnowledgeChangeProposal {
	if proposal == nil {
		return nil
	}
	return &model.KnowledgeChangeProposal{
		ID:        proposal.ID,
		ProjectID: proposal.ProjectID,
		DocID:     proposal.DocID,
		Status:    string(proposal.Status),
		Meta:      encodeDocumentMeta(proposal.Meta),
		Content:   encodeDocumentContent(proposal.Content),
		CreatedAt: proposal.CreatedAt,
		UpdatedAt: proposal.UpdatedAt,
	}
}

func KnowledgeChangeProposalToDomain(proposal *model.KnowledgeChangeProposal) *domain.KnowledgeChangeProposal {
	if proposal == nil {
		return nil
	}
	return &domain.KnowledgeChangeProposal{
		ID:        proposal.ID,
		ProjectID: proposal.ProjectID,
		DocID:     proposal.DocID,
		Status:    domain.KnowledgeChangeStatus(proposal.Status),
		Meta:      decodeDocumentMeta(proposal.Meta),
		Content:   decodeDocumentContent(proposal.Content),
		CreatedAt: proposal.CreatedAt,
		UpdatedAt: proposal.UpdatedAt,
	}
}

func encodeDocumentMeta(meta *domain.DocumentMeta) datatypes.JSON {
	if meta == nil {
		return nil
	}
	data, err := json.Marshal(meta)
	if err != nil {
		return nil
	}
	return datatypes.JSON(data)
}

func decodeDocumentMeta(value datatypes.JSON) *domain.DocumentMeta {
	if len(value) == 0 {
		return nil
	}
	var meta domain.DocumentMeta
	if err := json.Unmarshal(value, &meta); err != nil {
		return nil
	}
	return &meta
}

func encodeDocumentContent(content *domain.DocumentContent) datatypes.JSON {
	if content == nil {
		return nil
	}
	data, err := json.Marshal(content)
	if err != nil {
		return nil
	}
	return datatypes.JSON(data)
}

func decodeDocumentContent(value datatypes.JSON) *domain.DocumentContent {
	if len(value) == 0 {
		return nil
	}
	var content domain.DocumentContent
	if err := json.Unmarshal(value, &content); err != nil {
		return nil
	}
	return &content
}
