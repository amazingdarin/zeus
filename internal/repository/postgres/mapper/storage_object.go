package mapper

import (
	"zeus/internal/domain"
	"zeus/internal/repository/postgres/model"
)

func StorageObjectFromDomain(obj *domain.StorageObject) *model.StorageObject {
	if obj == nil {
		return nil
	}
	return &model.StorageObject{
		ID:                  obj.ID,
		SourceType:          string(obj.Source.Type),
		SourceUploadBatchID: obj.Source.UploadBatchID,
		SourceURL:           obj.Source.URL,
		SourceImportedFrom:  obj.Source.ImportedFrom,
		StorageType:         string(obj.Storage.Type),
		S3Bucket:            obj.Storage.Bucket,
		S3Key:               obj.Storage.Key,
		LocalBasePath:       obj.Storage.BasePath,
		LocalFilePath:       obj.Storage.FilePath,
		SizeBytes:           obj.SizeBytes,
		MimeType:            obj.MimeType,
		Checksum:            obj.Checksum,
		CreatedAt:           obj.CreatedAt,
		UpdatedAt:           obj.UpdatedAt,
	}
}

func StorageObjectToDomain(obj *model.StorageObject) *domain.StorageObject {
	if obj == nil {
		return nil
	}
	return &domain.StorageObject{
		ID: obj.ID,
		Source: domain.SourceInfo{
			Type:          domain.SourceType(obj.SourceType),
			UploadBatchID: obj.SourceUploadBatchID,
			URL:           obj.SourceURL,
			ImportedFrom:  obj.SourceImportedFrom,
		},
		Storage: domain.StorageInfo{
			Type:     domain.StorageType(obj.StorageType),
			Bucket:   obj.S3Bucket,
			Key:      obj.S3Key,
			BasePath: obj.LocalBasePath,
			FilePath: obj.LocalFilePath,
		},
		SizeBytes: obj.SizeBytes,
		MimeType:  obj.MimeType,
		Checksum:  obj.Checksum,
		CreatedAt: obj.CreatedAt,
		UpdatedAt: obj.UpdatedAt,
	}
}
