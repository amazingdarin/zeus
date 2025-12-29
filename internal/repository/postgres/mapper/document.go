package mapper

import (
	"fmt"

	"zeus/internal/domain"
	"zeus/internal/repository/postgres/model"
)

func DocumentFromDomain(doc *domain.Document) (*model.Document, *model.StorageObject, error) {
	if doc == nil {
		return nil, nil, fmt.Errorf("document is nil")
	}
	if doc.StorageObject == nil {
		return nil, nil, fmt.Errorf("storage object is required")
	}
	storage, err := StorageObjectFromDomain(doc.StorageObject)
	if err != nil {
		return nil, nil, err
	}
	return &model.Document{
		ID:              doc.ID,
		Type:            string(doc.Type),
		Title:           doc.Title,
		Description:     doc.Description,
		Status:          string(doc.Status),
		StorageObjectID: storage.ID,
		CreatedAt:       doc.CreatedAt,
		UpdatedAt:       doc.UpdatedAt,
	}, storage, nil
}

func DocumentToDomain(doc *model.Document, storage *model.StorageObject) (*domain.Document, error) {
	if doc == nil {
		return nil, fmt.Errorf("document model is nil")
	}

	var storageDomain *domain.StorageObject
	if storage != nil {
		mapped, err := StorageObjectToDomain(storage)
		if err != nil {
			return nil, err
		}
		storageDomain = mapped
	}

	return &domain.Document{
		ID:            doc.ID,
		Type:          domain.DocumentType(doc.Type),
		Title:         doc.Title,
		Description:   doc.Description,
		Status:        domain.DocumentStatus(doc.Status),
		StorageObject: storageDomain,
		CreatedAt:     doc.CreatedAt,
		UpdatedAt:     doc.UpdatedAt,
	}, nil
}
