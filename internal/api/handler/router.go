package handler

import (
	"github.com/gin-gonic/gin"

	"zeus/internal/service"
)

func RegisterRoutes(
	r *gin.Engine,
	storageObjectSvc service.StorageObjectService,
	documentSvc service.DocumentService,
) {
	storageObjectHandler := NewStorageObjectHandler(storageObjectSvc)

	api := r.Group("/api")

	// StorageObject
	api.POST("/storage-objects", storageObjectHandler.Create)
}
