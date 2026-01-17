package mapper

import (
	"zeus/internal/domain"
	"zeus/internal/repository/postgres/model"
)

func ProviderCredentialFromDomain(cred *domain.ProviderCredential) *model.ProviderCredential {
	if cred == nil {
		return nil
	}
	return &model.ProviderCredential{
		ID:           cred.ID,
		ProviderID:   cred.ProviderID,
		ScopeType:    string(cred.ScopeType),
		ScopeID:      cred.ScopeID,
		Type:         string(cred.Type),
		Ciphertext:   cred.Ciphertext,
		Nonce:        cred.Nonce,
		EncryptedKey: cred.EncryptedKey,
		KeyID:        cred.KeyID,
		KeyVersion:   cred.KeyVersion,
		ExpiresAt:    cred.ExpiresAt,
		Scopes:       cred.Scopes,
		Metadata:     encodeJSON(cred.Metadata),
		CreatedAt:    cred.CreatedAt,
		UpdatedAt:    cred.UpdatedAt,
		CreatedBy:    cred.CreatedBy,
		UpdatedBy:    cred.UpdatedBy,
		LastUsedAt:   cred.LastUsedAt,
		LastUsedBy:   cred.LastUsedBy,
	}
}

func ProviderCredentialToDomain(cred *model.ProviderCredential) *domain.ProviderCredential {
	if cred == nil {
		return nil
	}
	return &domain.ProviderCredential{
		ID:           cred.ID,
		ProviderID:   cred.ProviderID,
		ScopeType:    domain.ProviderCredentialScope(cred.ScopeType),
		ScopeID:      cred.ScopeID,
		Type:         domain.ProviderCredentialType(cred.Type),
		Ciphertext:   cred.Ciphertext,
		Nonce:        cred.Nonce,
		EncryptedKey: cred.EncryptedKey,
		KeyID:        cred.KeyID,
		KeyVersion:   cred.KeyVersion,
		ExpiresAt:    cred.ExpiresAt,
		Scopes:       cred.Scopes,
		Metadata:     decodeJSON(cred.Metadata),
		CreatedAt:    cred.CreatedAt,
		UpdatedAt:    cred.UpdatedAt,
		CreatedBy:    cred.CreatedBy,
		UpdatedBy:    cred.UpdatedBy,
		LastUsedAt:   cred.LastUsedAt,
		LastUsedBy:   cred.LastUsedBy,
	}
}
