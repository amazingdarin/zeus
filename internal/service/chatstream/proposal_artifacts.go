package chatstream

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"zeus/internal/domain"
	"zeus/internal/service"
)

type ChangeProposalCreator interface {
	CreateChangeProposal(
		ctx context.Context,
		projectKey, docID string,
		req service.KnowledgeChangeRequest,
	) (domain.KnowledgeChangeProposal, error)
}

func buildProposalArtifacts(
	ctx context.Context,
	creator ChangeProposalCreator,
	slash SlashResult,
	projectKey string,
	message string,
) []ChatArtifact {
	artifacts := append([]ChatArtifact(nil), slash.Artifacts...)
	if creator == nil || slash.Command != "propose" || strings.TrimSpace(projectKey) == "" {
		return artifacts
	}
	payload, ok := parseProposalPayload(message)
	if !ok || payload.DocID == "" {
		return artifacts
	}
	proposal, err := creator.CreateChangeProposal(ctx, projectKey, payload.DocID, service.KnowledgeChangeRequest{
		Meta:    payload.Meta,
		Content: payload.Content,
	})
	if err != nil {
		return artifacts
	}
	title := payload.DocID
	if payload.Meta != nil && strings.TrimSpace(payload.Meta.Title) != "" {
		title = strings.TrimSpace(payload.Meta.Title)
	}
	artifacts = append(artifacts, ChatArtifact{
		Type:  "diff_list",
		Title: "Change Proposals",
		Data: map[string]any{
			"items": []map[string]string{
				{
					"doc_id":      proposal.DocID,
					"title":       title,
					"proposal_id": proposal.ID,
				},
			},
			"actions": []map[string]string{
				{"type": "open", "label": "View diff"},
				{"type": "apply", "label": "Apply"},
				{"type": "reject", "label": "Reject"},
			},
		},
	})
	artifacts = append(artifacts, ChatArtifact{
		Type:  "document.diff",
		Title: "Change Proposal",
		Data: map[string]any{
			"doc_id":          proposal.DocID,
			"proposal_id":     proposal.ID,
			"proposal_status": string(proposal.Status),
		},
	})
	return artifacts
}

type proposalPayload struct {
	DocID   string
	Meta    *domain.DocumentMeta
	Content *domain.DocumentContent
}

func parseProposalPayload(message string) (proposalPayload, bool) {
	raw := extractJSONPayload(message)
	if raw == "" {
		return proposalPayload{}, false
	}
	var payload struct {
		DocID   string          `json:"doc_id"`
		Meta    json.RawMessage `json:"meta"`
		Content json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return proposalPayload{}, false
	}
	docID := strings.TrimSpace(payload.DocID)
	if docID == "" {
		return proposalPayload{}, false
	}
	var meta *domain.DocumentMeta
	if !isJSONEmpty(payload.Meta) {
		var parsed domain.DocumentMeta
		if err := json.Unmarshal(payload.Meta, &parsed); err != nil {
			return proposalPayload{}, false
		}
		meta = &parsed
	}
	content, err := parseDocumentContent(payload.Content)
	if err != nil {
		return proposalPayload{}, false
	}
	if meta == nil && content == nil {
		return proposalPayload{}, false
	}
	return proposalPayload{
		DocID:   docID,
		Meta:    meta,
		Content: content,
	}, true
}

func extractJSONPayload(message string) string {
	trimmed := strings.TrimSpace(message)
	if strings.HasPrefix(trimmed, "{") {
		return trimmed
	}
	start := strings.Index(trimmed, "```")
	if start == -1 {
		return ""
	}
	rest := trimmed[start+3:]
	rest = strings.TrimLeft(rest, " \n\r\t")
	if strings.HasPrefix(rest, "json") {
		rest = strings.TrimLeft(rest[len("json"):], " \n\r\t")
	}
	end := strings.Index(rest, "```")
	if end == -1 {
		return ""
	}
	return strings.TrimSpace(rest[:end])
}

func parseDocumentContent(raw json.RawMessage) (*domain.DocumentContent, error) {
	if isJSONEmpty(raw) {
		return nil, nil
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	if isTipTapDoc(payload) {
		return &domain.DocumentContent{
			Meta:    map[string]interface{}{},
			Content: payload,
		}, nil
	}
	if hasContentPayload(payload) {
		meta, err := parseMetaNode(payload["meta"])
		if err != nil {
			return nil, err
		}
		contentNode, err := parseContentNode(payload["content"])
		if err != nil {
			return nil, err
		}
		return &domain.DocumentContent{
			Meta:    meta,
			Content: contentNode,
		}, nil
	}
	return &domain.DocumentContent{
		Meta:    map[string]interface{}{},
		Content: payload,
	}, nil
}

func hasContentPayload(payload map[string]interface{}) bool {
	if payload == nil {
		return false
	}
	if _, ok := payload["content"]; ok {
		return true
	}
	_, ok := payload["meta"]
	return ok
}

func isTipTapDoc(payload map[string]interface{}) bool {
	if payload == nil {
		return false
	}
	_, ok := payload["type"]
	return ok
}

func parseMetaNode(node interface{}) (map[string]interface{}, error) {
	if node == nil {
		return map[string]interface{}{}, nil
	}
	meta, ok := node.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("meta must be an object")
	}
	return meta, nil
}

func parseContentNode(node interface{}) (map[string]interface{}, error) {
	if node == nil {
		return map[string]interface{}{}, nil
	}
	content, ok := node.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("content must be an object")
	}
	return content, nil
}

func isJSONEmpty(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return true
	}
	return bytes.Equal(trimmed, []byte("null"))
}
