package service

import (
	documentservice "zeus/internal/modules/document/service"
	projectservice "zeus/internal/modules/project/service"
)

// Services aggregates application services.
type Services struct {
	StorageObject StorageObjectService
	Asset         documentservice.AssetService
	Project       projectservice.ProjectService
	Document      documentservice.DocumentService
}
