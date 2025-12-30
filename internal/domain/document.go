package domain

import (
	"time"
)

type DocumentType string

const (
	DocumentTypeOverview    DocumentType = "overview"    // 项目概览
	DocumentTypeModule      DocumentType = "module"      // 功能模块
	DocumentTypeApi         DocumentType = "api"         // API文档
	DocumentTypeOrigin      DocumentType = "origin"      // 原始文档
	DocumentTypeRequirement DocumentType = "requirement" // 需求文档
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
	HasChild bool        // 是否包含子文档

	CreatedAt time.Time
	UpdatedAt time.Time
}
