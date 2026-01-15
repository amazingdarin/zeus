package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"zeus/internal/api/types"
	"zeus/internal/domain"
	"zeus/internal/repository"
	"zeus/internal/service"
)

// CreateProposal
// @route POST /api/projects/:project_key/documents/:doc_id/proposals
func (h *KnowledgeHandler) CreateProposal(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	docID := strings.TrimSpace(c.Param("doc_id"))
	if docID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_DOCUMENT_ID",
			Message: "doc_id is required",
		})
		return
	}

	var req types.KnowledgeChangeProposalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "INVALID_REQUEST",
			Message: err.Error(),
		})
		return
	}

	var metaPatch *domain.DocumentMeta
	if req.Meta != nil {
		metaPatch = &domain.DocumentMeta{
			ID:      strings.TrimSpace(req.Meta.ID),
			Slug:    strings.TrimSpace(req.Meta.Slug),
			Title:   strings.TrimSpace(req.Meta.Title),
			Parent:  strings.TrimSpace(req.Meta.Parent),
			Path:    strings.TrimSpace(req.Meta.Path),
			Status:  strings.TrimSpace(req.Meta.Status),
			DocType: strings.TrimSpace(req.Meta.DocType),
			Tags:    req.Meta.Tags,
		}
	}

	var contentPatch *domain.DocumentContent
	if !isJSONEmpty(req.Content) {
		parsed, err := parseContentPayload(req.Content)
		if err != nil {
			c.JSON(http.StatusBadRequest, types.ErrorResponse{
				Code:    "INVALID_CONTENT",
				Message: err.Error(),
			})
			return
		}
		contentPatch = &parsed
	}

	proposal, err := h.knowledgeSvc.CreateChangeProposal(
		c.Request.Context(),
		projectKey,
		docID,
		service.KnowledgeChangeRequest{
			Meta:    metaPatch,
			Content: contentPatch,
		},
	)
	if err != nil {
		if errors.Is(err, repository.ErrDocumentNotFound) {
			c.JSON(http.StatusNotFound, types.ErrorResponse{
				Code:    "DOCUMENT_NOT_FOUND",
				Message: "document not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "CREATE_PROPOSAL_FAILED",
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, types.KnowledgeChangeProposalResponse{
		Code:    "OK",
		Message: "success",
		Data: types.KnowledgeChangeProposalDTO{
			ID:        proposal.ID,
			DocID:     proposal.DocID,
			Status:    string(proposal.Status),
			CreatedAt: formatTime(proposal.CreatedAt),
			UpdatedAt: formatTime(proposal.UpdatedAt),
		},
	})
}

// DiffProposal
// @route GET /api/projects/:project_key/documents/:doc_id/proposals/:proposal_id/diff
func (h *KnowledgeHandler) DiffProposal(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	docID := strings.TrimSpace(c.Param("doc_id"))
	if docID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_DOCUMENT_ID",
			Message: "doc_id is required",
		})
		return
	}
	proposalID := strings.TrimSpace(c.Param("proposal_id"))
	if proposalID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROPOSAL_ID",
			Message: "proposal_id is required",
		})
		return
	}

	diff, err := h.knowledgeSvc.GetChangeProposalDiff(
		c.Request.Context(),
		projectKey,
		docID,
		proposalID,
	)
	if err != nil {
		if errors.Is(err, repository.ErrDocumentNotFound) ||
			errors.Is(err, repository.ErrKnowledgeChangeProposalNotFound) {
			c.JSON(http.StatusNotFound, types.ErrorResponse{
				Code:    "PROPOSAL_NOT_FOUND",
				Message: "proposal not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "DIFF_PROPOSAL_FAILED",
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, types.KnowledgeChangeDiffResponse{
		Code:    "OK",
		Message: "success",
		Data: types.KnowledgeChangeDiffDTO{
			TargetDocID:  diff.TargetDocID,
			BaseRevision: diff.BaseRevision,
			MetaDiff:     diff.MetaDiff,
			ContentDiff:  diff.ContentDiff,
		},
	})
}

// ApplyProposal
// @route POST /api/projects/:project_key/documents/:doc_id/proposals/:proposal_id/apply
func (h *KnowledgeHandler) ApplyProposal(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	if projectKey == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROJECT_KEY",
			Message: "project_key is required",
		})
		return
	}
	docID := strings.TrimSpace(c.Param("doc_id"))
	if docID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_DOCUMENT_ID",
			Message: "doc_id is required",
		})
		return
	}
	proposalID := strings.TrimSpace(c.Param("proposal_id"))
	if proposalID == "" {
		c.JSON(http.StatusBadRequest, types.ErrorResponse{
			Code:    "MISSING_PROPOSAL_ID",
			Message: "proposal_id is required",
		})
		return
	}

	meta, content, err := h.knowledgeSvc.ApplyChangeProposal(
		c.Request.Context(),
		projectKey,
		docID,
		proposalID,
	)
	if err != nil {
		if errors.Is(err, repository.ErrDocumentNotFound) ||
			errors.Is(err, repository.ErrKnowledgeChangeProposalNotFound) {
			c.JSON(http.StatusNotFound, types.ErrorResponse{
				Code:    "PROPOSAL_NOT_FOUND",
				Message: "proposal not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "APPLY_PROPOSAL_FAILED",
			Message: err.Error(),
		})
		return
	}

	hierarchyItems, err := h.knowledgeSvc.GetDocumentHierarchy(c.Request.Context(), projectKey, docID)
	if err != nil {
		if errors.Is(err, repository.ErrDocumentNotFound) {
			c.JSON(http.StatusNotFound, types.ErrorResponse{
				Code:    "DOCUMENT_NOT_FOUND",
				Message: "document not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, types.ErrorResponse{
			Code:    "GET_DOCUMENT_HIERARCHY_FAILED",
			Message: err.Error(),
		})
		return
	}
	hierarchy := make([]types.KnowledgeDocumentHierarchyDTO, 0, len(hierarchyItems))
	for _, item := range hierarchyItems {
		hierarchy = append(hierarchy, types.KnowledgeDocumentHierarchyDTO{
			ID:   item.ID,
			Name: item.Name,
		})
	}

	c.JSON(http.StatusOK, types.KnowledgeDocumentResponse{
		Code:    "OK",
		Message: "success",
		Data:    mapDocumentDTOWithHierarchy(meta, content, hierarchy),
	})
}

// RejectProposal
// @route POST /api/projects/:project_key/documents/:doc_id/proposals/:proposal_id/reject
func (h *KnowledgeHandler) RejectProposal(c *gin.Context) {
	projectKey := strings.TrimSpace(c.Param("project_key"))
	docID := strings.TrimSpace(c.Param("doc_id"))
	proposalID := strings.TrimSpace(c.Param("proposal_id"))
	if projectKey == "" || docID == "" || proposalID == "" {
		c.JSON(http.StatusBadRequest, types.SimpleResponse{
			Code:    "INVALID_REQUEST",
			Message: "project_key, doc_id, proposal_id are required",
		})
		return
	}
	if h.knowledgeSvc == nil {
		c.JSON(http.StatusInternalServerError, types.SimpleResponse{
			Code:    "SERVICE_NOT_READY",
			Message: "knowledge service is required",
		})
		return
	}
	if err := h.knowledgeSvc.RejectChangeProposal(
		c.Request.Context(),
		projectKey,
		docID,
		proposalID,
	); err != nil {
		if errors.Is(err, repository.ErrKnowledgeChangeProposalNotFound) {
			c.JSON(http.StatusNotFound, types.SimpleResponse{
				Code:    "PROPOSAL_NOT_FOUND",
				Message: "proposal not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, types.SimpleResponse{
			Code:    "REJECT_PROPOSAL_FAILED",
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, types.SimpleResponse{
		Code:    "OK",
		Message: "proposal rejected",
	})
}
