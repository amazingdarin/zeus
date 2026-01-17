package model

import (
	"time"

	"gorm.io/datatypes"
)

type ProviderCredential struct {
	ID           string         `gorm:"column:id;primaryKey"`
	ProviderID   string         `gorm:"column:provider_id;not null"`
	ScopeType    string         `gorm:"column:scope_type;not null"`
	ScopeID      string         `gorm:"column:scope_id"`
	Type         string         `gorm:"column:type;not null"`
	Ciphertext   string         `gorm:"column:ciphertext;not null"`
	Nonce        string         `gorm:"column:nonce;not null"`
	EncryptedKey string         `gorm:"column:encrypted_key;not null"`
	KeyID        string         `gorm:"column:key_id;not null"`
	KeyVersion   int            `gorm:"column:key_version;not null"`
	ExpiresAt    *time.Time     `gorm:"column:expires_at"`
	Scopes       string         `gorm:"column:scopes"`
	Metadata     datatypes.JSON `gorm:"column:metadata;type:jsonb"`
	CreatedAt    time.Time      `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt    time.Time      `gorm:"column:updated_at;autoUpdateTime"`
	CreatedBy    string         `gorm:"column:created_by"`
	UpdatedBy    string         `gorm:"column:updated_by"`
	LastUsedAt   *time.Time     `gorm:"column:last_used_at"`
	LastUsedBy   string         `gorm:"column:last_used_by"`
}

func (ProviderCredential) TableName() string {
	return "provider_credential"
}
