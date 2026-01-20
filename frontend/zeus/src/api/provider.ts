import { apiFetch } from "../config/api";

export type ProviderDefinition = {
  id: string;
  name: string;
  capabilities: string[];
  authType: string;
  description?: string;
  isCustom?: boolean;
};

export type ProviderConnection = {
  id: string;
  providerId: string;
  displayName: string;
  baseUrl?: string;
  modelName?: string;
  credentialId: string;
  status: string;
  lastError?: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ConnectionInput = {
  id?: string;
  providerId: string;
  displayName: string;
  baseUrl?: string;
  modelName?: string;
  credentialId: string;
};

const parseResponse = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || payload?.error || "Request failed";
    const error = new Error(message) as Error & {
      status?: string;
      statusCode?: number;
      status_code?: string;
    };
    if (payload?.data?.status) {
      error.status = String(payload.data.status);
    }
    if (payload?.data?.description) {
      error.message = String(payload.data.description || message);
    }
    error.statusCode = response.status;
    error.status_code = payload?.data?.status ? String(payload.data.status) : undefined;
    throw error;
  }
  return payload;
};

export const fetchProviders = async (): Promise<ProviderDefinition[]> => {
  const response = await apiFetch("/api/providers");
  const payload = await parseResponse(response);
  const items = Array.isArray(payload?.data) ? payload.data : [];
  return items.map((item: any) => ({
    id: String(item.id),
    name: String(item.name),
    capabilities: Array.isArray(item.capabilities) ? item.capabilities : [],
    authType: String(item.auth_type),
    description: item.description ? String(item.description) : undefined,
    isCustom: typeof item.is_custom === "boolean" ? item.is_custom : undefined,
  }));
};

export const fetchConnections = async (): Promise<ProviderConnection[]> => {
  const response = await apiFetch("/api/provider-connections");
  const payload = await parseResponse(response);
  const items = Array.isArray(payload?.data) ? payload.data : [];
  return items.map((item: any) => ({
    id: String(item.id),
    providerId: String(item.provider_id),
    displayName: String(item.display_name),
    baseUrl: item.base_url ? String(item.base_url) : undefined,
    modelName: item.model_name ? String(item.model_name) : undefined,
    credentialId: String(item.credential_id),
    status: String(item.status),
    lastError: item.last_error ? String(item.last_error) : undefined,
    lastUsedAt: item.last_used_at ? String(item.last_used_at) : undefined,
    createdAt: String(item.created_at),
    updatedAt: String(item.updated_at),
  }));
};

export const upsertConnection = async (input: ConnectionInput): Promise<ProviderConnection> => {
  const response = await apiFetch("/api/provider-connections", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: input.id,
      provider_id: input.providerId,
      display_name: input.displayName,
      base_url: input.baseUrl,
      model_name: input.modelName,
      credential_id: input.credentialId,
    }),
  });
  const payload = await parseResponse(response);
  const item = payload?.data ?? {};
  return {
    id: String(item.id),
    providerId: String(item.provider_id),
    displayName: String(item.display_name),
    baseUrl: item.base_url ? String(item.base_url) : undefined,
    modelName: item.model_name ? String(item.model_name) : undefined,
    credentialId: String(item.credential_id),
    status: String(item.status),
    lastError: item.last_error ? String(item.last_error) : undefined,
    lastUsedAt: item.last_used_at ? String(item.last_used_at) : undefined,
    createdAt: String(item.created_at),
    updatedAt: String(item.updated_at),
  };
};

export const fetchConnectionModels = async (connectionId: string): Promise<string[]> => {
  const response = await apiFetch(`/api/provider-connections/${connectionId}/models`);
  const payload = await parseResponse(response);
  return Array.isArray(payload?.data) ? payload.data.map((item: any) => String(item)) : [];
};

export const testProvider = async (connectionId: string, scenario: string): Promise<void> => {
  const response = await apiFetch("/api/providers/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      connection_id: connectionId,
      scenario,
    }),
  });
  await parseResponse(response);
};

export const startDeviceAuth = async (
  providerId: string,
  scopeType?: string,
  scopeId?: string,
): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt?: string;
  interval: number;
}> => {
  const response = await apiFetch(`/api/providers/${providerId}/auth/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scope_type: scopeType,
      scope_id: scopeId,
    }),
  });
  const payload = await parseResponse(response);
  const data = payload?.data ?? {};
  return {
    deviceCode: String(data.device_code),
    userCode: String(data.user_code),
    verificationUri: String(data.verification_uri),
    expiresAt: data.expires_at ? String(data.expires_at) : undefined,
    interval: Number(data.interval),
  };
};

export const pollDeviceAuth = async (
  providerId: string,
  deviceCode: string,
  scopeType?: string,
  scopeId?: string,
): Promise<{ credentialId: string }> => {
  const response = await apiFetch(`/api/providers/${providerId}/auth/poll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      device_code: deviceCode,
      scope_type: scopeType,
      scope_id: scopeId,
    }),
  });
  const payload = await parseResponse(response);
  if (payload?.data?.status) {
    const error = new Error(payload?.data?.description || payload?.message || "Device authorization pending") as Error & {
      status?: string;
      statusCode?: number;
    };
    error.status = String(payload.data.status);
    error.statusCode = response.status;
    throw error;
  }
  return {
    credentialId: String(payload?.data?.id ?? ""),
  };
};

export const storeApiKey = async (
  providerId: string,
  apiKey: string,
  scopeType?: string,
  scopeId?: string,
): Promise<{ credentialId: string }> => {
  const response = await apiFetch(`/api/providers/${providerId}/auth/api`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      scope_type: scopeType,
      scope_id: scopeId,
    }),
  });
  const payload = await parseResponse(response);
  return {
    credentialId: String(payload?.data?.id ?? ""),
  };
};
