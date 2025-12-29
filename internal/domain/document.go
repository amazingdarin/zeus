package domain

import (
	"time"
)

type DocumentType string

const (
	DocumentTypeRaw     DocumentType = "raw"     // 原始文件
	DocumentTypeManual  DocumentType = "manual"  // 人工录入
	DocumentTypeDerived DocumentType = "derived" // 系统生成
)

type DocumentStatus string

const (
	DocumentStatusActive   DocumentStatus = "active"
	DocumentStatusArchived DocumentStatus = "archived"
)

type Document struct {
	ID        string
	ProjectID string

	Type        DocumentType   // 文档类型
	Title       string         // 标题
	Description string         // 副标题
	Status      DocumentStatus // 生命周期

	Path          string         // 层级目录
	Order         int            // 同级排序
	StorageObject *StorageObject // 存储信息

	Parent   *Document   // 父级文档
	Children []*Document // 子文档

	CreatedAt time.Time
	UpdatedAt time.Time
}
