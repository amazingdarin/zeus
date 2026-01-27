package knowledge

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"zeus/internal/domain"
	"zeus/internal/repository"
	"zeus/internal/service"
)

func (s *Service) CreateChangeProposal(
	ctx context.Context,
	projectKey, docID string,
	req service.KnowledgeChangeRequest,
) (domain.KnowledgeChangeProposal, error) {
	projectKey = strings.TrimSpace(projectKey)
	docID = strings.TrimSpace(docID)
	if projectKey == "" {
		return domain.KnowledgeChangeProposal{}, fmt.Errorf("project key is required")
	}
	if docID == "" {
		return domain.KnowledgeChangeProposal{}, fmt.Errorf("doc id is required")
	}
	if req.Meta == nil && req.Content == nil {
		return domain.KnowledgeChangeProposal{}, fmt.Errorf("proposal is empty")
	}
	if s.proposalRepo == nil {
		return domain.KnowledgeChangeProposal{}, fmt.Errorf("proposal repo is required")
	}

	project, err := s.projectRepo.FindByKey(ctx, projectKey)
	if err != nil {
		return domain.KnowledgeChangeProposal{}, fmt.Errorf("find project: %w", err)
	}
	if project == nil {
		return domain.KnowledgeChangeProposal{}, fmt.Errorf("project not found")
	}

	existingMeta, _, err := s.knowledgeRepo.ReadDocument(ctx, project.RepoName, docID)
	if err != nil {
		return domain.KnowledgeChangeProposal{}, err
	}

	metaPatch, err := sanitizeMetaPatch(existingMeta, req.Meta)
	if err != nil {
		return domain.KnowledgeChangeProposal{}, err
	}
	if metaPatch == nil && req.Content == nil {
		return domain.KnowledgeChangeProposal{}, fmt.Errorf("proposal is empty")
	}

	now := time.Now().UTC()
	proposal := domain.KnowledgeChangeProposal{
		ID:        uuid.NewString(),
		ProjectID: project.ID,
		DocID:     docID,
		Status:    domain.KnowledgeChangePending,
		Meta:      metaPatch,
		Content:   req.Content,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.proposalRepo.Create(ctx, &proposal); err != nil {
		return domain.KnowledgeChangeProposal{}, err
	}
	return proposal, nil
}

func (s *Service) GetChangeProposalDiff(
	ctx context.Context,
	projectKey, docID, proposalID string,
) (service.KnowledgeChangeDiff, error) {
	projectKey = strings.TrimSpace(projectKey)
	docID = strings.TrimSpace(docID)
	proposalID = strings.TrimSpace(proposalID)
	if projectKey == "" {
		return service.KnowledgeChangeDiff{}, fmt.Errorf("project key is required")
	}
	if docID == "" {
		return service.KnowledgeChangeDiff{}, fmt.Errorf("doc id is required")
	}
	if proposalID == "" {
		return service.KnowledgeChangeDiff{}, fmt.Errorf("proposal id is required")
	}
	if s.proposalRepo == nil {
		return service.KnowledgeChangeDiff{}, fmt.Errorf("proposal repo is required")
	}

	project, err := s.projectRepo.FindByKey(ctx, projectKey)
	if err != nil {
		return service.KnowledgeChangeDiff{}, fmt.Errorf("find project: %w", err)
	}
	if project == nil {
		return service.KnowledgeChangeDiff{}, fmt.Errorf("project not found")
	}

	baseMeta, baseContent, err := s.knowledgeRepo.ReadDocument(ctx, project.RepoName, docID)
	if err != nil {
		return service.KnowledgeChangeDiff{}, err
	}

	proposal, ok, err := s.proposalRepo.Get(ctx, proposalID)
	if err != nil {
		return service.KnowledgeChangeDiff{}, err
	}
	if !ok || proposal == nil {
		return service.KnowledgeChangeDiff{}, repository.ErrKnowledgeChangeProposalNotFound
	}
	if proposal.ProjectID != project.ID || proposal.DocID != docID {
		return service.KnowledgeChangeDiff{}, repository.ErrKnowledgeChangeProposalNotFound
	}

	proposedMeta := baseMeta
	if proposal.Meta != nil {
		proposedMeta = applyMetaPatch(baseMeta, proposal.Meta)
	}
	proposedContent := baseContent
	if proposal.Content != nil {
		proposedContent = *proposal.Content
	}

	baseRevision := ""
	if s.knowledgeRepo != nil {
		revision, err := s.knowledgeRepo.CurrentRevision(ctx, project.RepoName)
		if err != nil {
			return service.KnowledgeChangeDiff{}, err
		}
		baseRevision = revision
	}

	metaDiff, err := diffJSON(baseMeta, proposedMeta, "meta.json", "proposal.meta.json")
	if err != nil {
		return service.KnowledgeChangeDiff{}, err
	}
	contentDiff, err := diffJSON(
		baseContent,
		proposedContent,
		"content.json",
		"proposal.content.json",
	)
	if err != nil {
		return service.KnowledgeChangeDiff{}, err
	}

	return service.KnowledgeChangeDiff{
		TargetDocID:  docID,
		BaseRevision: baseRevision,
		MetaDiff:     metaDiff,
		ContentDiff:  contentDiff,
	}, nil
}

func (s *Service) ApplyChangeProposal(
	ctx context.Context,
	projectKey, docID, proposalID string,
) (domain.DocumentMeta, domain.DocumentContent, error) {
	projectKey = strings.TrimSpace(projectKey)
	docID = strings.TrimSpace(docID)
	proposalID = strings.TrimSpace(proposalID)
	if projectKey == "" {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("project key is required")
	}
	if docID == "" {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("doc id is required")
	}
	if proposalID == "" {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("proposal id is required")
	}
	if s.proposalRepo == nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("proposal repo is required")
	}

	project, err := s.projectRepo.FindByKey(ctx, projectKey)
	if err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("find project: %w", err)
	}
	if project == nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("project not found")
	}

	existingMeta, existingContent, err := s.knowledgeRepo.ReadDocument(ctx, project.RepoName, docID)
	if err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}

	proposal, ok, err := s.proposalRepo.Get(ctx, proposalID)
	if err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}
	if !ok || proposal == nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, repository.ErrKnowledgeChangeProposalNotFound
	}
	if proposal.ProjectID != project.ID || proposal.DocID != docID {
		return domain.DocumentMeta{}, domain.DocumentContent{}, repository.ErrKnowledgeChangeProposalNotFound
	}

	now := time.Now()
	var metaPatch *domain.DocumentMeta
	if proposal.Meta != nil {
		metaPatch, err = buildMetaPatch(existingMeta, proposal.Meta, now)
		if err != nil {
			return domain.DocumentMeta{}, domain.DocumentContent{}, err
		}
	}

	var contentPatch *domain.DocumentContent
	if proposal.Content != nil {
		normalized := normalizeContent(*proposal.Content, existingContent.Meta, now)
		contentPatch = &normalized
	}

	if metaPatch == nil && contentPatch == nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, fmt.Errorf("proposal has no changes")
	}

	if err := s.knowledgeRepo.UpdateDocument(ctx, project.RepoName, docID, metaPatch, contentPatch); err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}

	ctxNoPull := withSkipRepoPull(ctx)
	if err := s.knowledgeRepo.Commit(
		ctxNoPull,
		project.RepoName,
		fmt.Sprintf("docs: apply proposal %s", proposalID),
	); err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}

	if err := s.proposalRepo.UpdateStatus(ctx, proposalID, domain.KnowledgeChangeApplied); err != nil {
		return domain.DocumentMeta{}, domain.DocumentContent{}, err
	}

	updatedMeta := existingMeta
	if metaPatch != nil {
		updatedMeta = applyMetaPatch(existingMeta, metaPatch)
	}
	updatedContent := existingContent
	if contentPatch != nil {
		updatedContent = *contentPatch
	}
	return updatedMeta, updatedContent, nil
}

func (s *Service) RejectChangeProposal(
	ctx context.Context,
	projectKey, docID, proposalID string,
) error {
	projectKey = strings.TrimSpace(projectKey)
	docID = strings.TrimSpace(docID)
	proposalID = strings.TrimSpace(proposalID)
	if projectKey == "" {
		return fmt.Errorf("project key is required")
	}
	if docID == "" {
		return fmt.Errorf("doc id is required")
	}
	if proposalID == "" {
		return fmt.Errorf("proposal id is required")
	}
	if s.proposalRepo == nil {
		return fmt.Errorf("proposal repo is required")
	}

	project, err := s.projectRepo.FindByKey(ctx, projectKey)
	if err != nil {
		return fmt.Errorf("find project: %w", err)
	}
	if project == nil {
		return fmt.Errorf("project not found")
	}

	proposal, ok, err := s.proposalRepo.Get(ctx, proposalID)
	if err != nil {
		return err
	}
	if !ok || proposal == nil {
		return repository.ErrKnowledgeChangeProposalNotFound
	}
	if proposal.ProjectID != project.ID || proposal.DocID != docID {
		return repository.ErrKnowledgeChangeProposalNotFound
	}

	return s.proposalRepo.UpdateStatus(ctx, proposalID, domain.KnowledgeChangeRejected)
}

func sanitizeMetaPatch(
	existing domain.DocumentMeta,
	req *domain.DocumentMeta,
) (*domain.DocumentMeta, error) {
	if req == nil {
		return nil, nil
	}
	if req.ID != "" && req.ID != existing.ID {
		return nil, fmt.Errorf("doc id mismatch")
	}
	if req.Slug != "" && req.Slug != existing.Slug {
		return nil, fmt.Errorf("doc slug mismatch")
	}
	patch := &domain.DocumentMeta{}
	if title := strings.TrimSpace(req.Title); title != "" {
		patch.Title = title
	}
	if parent := strings.TrimSpace(req.Parent); parent != "" {
		patch.Parent = parent
	}
	if path := strings.TrimSpace(req.Path); path != "" {
		patch.Path = path
	}
	if status := strings.TrimSpace(req.Status); status != "" {
		patch.Status = status
	}
	if docType := strings.TrimSpace(req.DocType); docType != "" {
		patch.DocType = docType
	}
	if req.Tags != nil {
		patch.Tags = req.Tags
	}
	if patch.Title == "" && patch.Parent == "" && patch.Path == "" && patch.Status == "" && patch.DocType == "" && patch.Tags == nil {
		return nil, nil
	}
	return patch, nil
}
