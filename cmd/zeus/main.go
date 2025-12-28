package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	"zeus/internal/api"
	documentsvc "zeus/internal/service/document"
)

const defaultAddr = ":8080"

type stubDocumentService struct{}

func (s stubDocumentService) UploadDocument(ctx context.Context, req documentsvc.UploadRequest) (*documentsvc.UploadResponse, error) {
	return nil, errors.New("document service not implemented")
}

func main() {
	addr := getenv("ZEUS_HTTP_ADDR", defaultAddr)

	handler := api.NewDocumentHandler(stubDocumentService{})

	mux := http.NewServeMux()
	mux.HandleFunc("/documents/upload", handler.UploadDocument)

	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("zeus listening on %s", addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server error: %v", err)
	}
}

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
