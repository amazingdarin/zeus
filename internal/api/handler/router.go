package handler

import (
	"github.com/gin-gonic/gin"

	"zeus/internal/service"
)

func RegisterRoutes(
	r *gin.Engine,
	uploadSvc service.UploadService,
	rawDocSvc service.RawDocumentService,
) {
	uploadHandler := NewUploadHandler(uploadSvc)
	rawDocHandler := NewRawDocumentHandler(rawDocSvc)

	api := r.Group("/api")

	// Upload
	api.POST("/uploads", uploadHandler.CreateUploadBatch)
	api.POST("/uploads/:batch_id/files", uploadHandler.UploadFile)

	// Raw documents
	api.GET("/raw-documents", rawDocHandler.ListRawDocuments)
	api.GET("/raw-documents/:doc_id", rawDocHandler.GetRawDocument)
}
