package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	documentsvc "zeus/internal/service/document"
)

const maxUploadSize = 32 << 20

type DocumentHandler struct {
	service documentsvc.Service
}

func NewDocumentHandler(service documentsvc.Service) *DocumentHandler {
	return &DocumentHandler{service: service}
}

func (h *DocumentHandler) UploadDocument(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if h == nil || h.service == nil {
		writeError(w, http.StatusInternalServerError, "service not configured")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form")
		return
	}

	batchID := strings.TrimSpace(r.FormValue("batch_id"))
	if batchID == "" {
		writeError(w, http.StatusBadRequest, "batch_id is required")
		return
	}

	title := strings.TrimSpace(r.FormValue("title"))

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()

	content, err := io.ReadAll(io.LimitReader(file, maxUploadSize+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read file")
		return
	}
	if int64(len(content)) > maxUploadSize {
		writeError(w, http.StatusRequestEntityTooLarge, "file too large")
		return
	}

	req := documentsvc.UploadRequest{
		BatchID:      batchID,
		Title:        title,
		OriginalPath: header.Filename,
		ContentType:  header.Header.Get("Content-Type"),
		Content:      content,
	}
	resp, err := h.service.UploadDocument(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("upload failed: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

type errorResponse struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, errorResponse{Error: message})
}
