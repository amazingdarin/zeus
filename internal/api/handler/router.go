package handler

import (
	"github.com/gin-gonic/gin"

	"zeus/internal/service"
)

func RegisterRoutes(
	r *gin.Engine,
	uploadSvc service.UploadService,
	documentSvc service.DocumentService,
) {
	uploadHandler := NewUploadHandler(uploadSvc)
	documentHandler := NewDocumentHandler(documentSvc)

	api := r.Group("/api")

	// Upload
	api.POST("/uploads", uploadHandler.CreateUploadBatch)
	api.POST("/uploads/:batch_id/files", uploadHandler.UploadFile)

	// Raw documents
	api.GET("/raw-documents", documentHandler.ListRawDocuments)
	api.GET("/raw-documents/:doc_id", documentHandler.GetRawDocument)
}
