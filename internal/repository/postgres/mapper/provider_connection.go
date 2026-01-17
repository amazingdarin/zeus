package mapper

import "zeus/internal/domain"
import "zeus/internal/repository/postgres/model"

func ProviderConnectionFromDomain(conn *domain.ProviderConnection) *model.ProviderConnection {
	if conn == nil {
		return nil
	}
	return &model.ProviderConnection{
		ID:           conn.ID,
		ProviderID:   conn.ProviderID,
		DisplayName:  conn.DisplayName,
		BaseURL:      conn.BaseURL,
		ModelName:    conn.ModelName,
		CredentialID: conn.CredentialID,
		Status:       string(conn.Status),
		LastError:    conn.LastError,
		LastUsedAt:   conn.LastUsedAt,
		CreatedAt:    conn.CreatedAt,
		UpdatedAt:    conn.UpdatedAt,
		CreatedBy:    conn.CreatedBy,
		UpdatedBy:    conn.UpdatedBy,
	}
}

func ProviderConnectionToDomain(conn *model.ProviderConnection) *domain.ProviderConnection {
	if conn == nil {
		return nil
	}
	return &domain.ProviderConnection{
		ID:           conn.ID,
		ProviderID:   conn.ProviderID,
		DisplayName:  conn.DisplayName,
		BaseURL:      conn.BaseURL,
		ModelName:    conn.ModelName,
		CredentialID: conn.CredentialID,
		Status:       domain.ProviderConnectionStatus(conn.Status),
		LastError:    conn.LastError,
		LastUsedAt:   conn.LastUsedAt,
		CreatedAt:    conn.CreatedAt,
		UpdatedAt:    conn.UpdatedAt,
		CreatedBy:    conn.CreatedBy,
		UpdatedBy:    conn.UpdatedBy,
	}
}
