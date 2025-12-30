package mapper

import (
	"zeus/internal/domain"
	"zeus/internal/repository/postgres/model"
)

func DocumentFromDomain(doc *domain.Document) *model.Document {
	parentID := ""
	storageObjectID := ""
	if doc.Parent != nil {
		parentID = doc.Parent.ID
	}
	if doc.StorageObject != nil {
		storageObjectID = doc.StorageObject.ID
	}
	return &model.Document{
		ID:              doc.ID,
		ProjectID:       doc.ProjectID,
		Type:            string(doc.Type),
		Title:           doc.Title,
		Description:     doc.Description,
		Status:          string(doc.Status),
		Path:            doc.Path,
		Order:           doc.Order,
		ParentID:        parentID,
		StorageObjectID: storageObjectID,
		CreatedAt:       doc.CreatedAt,
		UpdatedAt:       doc.UpdatedAt,

		StorageObject: StorageObjectFromDomain(doc.StorageObject),
	}
}

func DocumentToDomain(doc *model.Document) *domain.Document {
	if doc == nil {
		return nil
	}

	var storageDomain *domain.StorageObject
	if doc.StorageObject != nil {
		mapped := StorageObjectToDomain(doc.StorageObject)
		storageDomain = mapped
	}
	var parent *domain.Document
	if doc.ParentID != "" {
		parent = &domain.Document{ID: doc.ParentID}
	}

	return &domain.Document{
		ID:            doc.ID,
		ProjectID:     doc.ProjectID,
		Type:          domain.DocumentType(doc.Type),
		Title:         doc.Title,
		Description:   doc.Description,
		Status:        domain.DocumentStatus(doc.Status),
		Path:          doc.Path,
		Order:         doc.Order,
		Parent:        parent,
		StorageObject: storageDomain,
		CreatedAt:     doc.CreatedAt,
		UpdatedAt:     doc.UpdatedAt,
	}
}
