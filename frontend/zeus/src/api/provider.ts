import { apiFetch } from "../config/api";

export type ProviderDefinition = {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  authType: string;
  isCustom: boolean;
};

export type ProviderConnection = {
  id: string;
  providerId: string;
  displayName: string;
  baseUrl?: string;
  modelName: string;
  credentialId: string;
  status: string;
  lastError?: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ConnectionInput = {
  providerId: string;
  displayName: string;
  baseUrl?: string;
  modelName: string;
  apiKey?: string;
};

const parseResponse = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || payload?.error || "Request failed";
    throw new Error(message);
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
    description: String(item.description),
    capabilities: Array.isArray(item.capabilities) ? item.capabilities : [],
    authType: String(item.auth_type),
    isCustom: Boolean(item.is_custom),
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
    modelName: String(item.model_name),
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
      provider_id: input.providerId,
      display_name: input.displayName,
      base_url: input.baseUrl,
      model_name: input.modelName,
      api_key: input.apiKey,
    }),
  });
  const payload = await parseResponse(response);
  const item = payload?.data ?? {};
  return {
    id: String(item.id),
    providerId: String(item.provider_id),
    displayName: String(item.display_name),
    baseUrl: item.base_url ? String(item.base_url) : undefined,
    modelName: String(item.model_name),
    credentialId: String(item.credential_id),
    status: String(item.status),
    lastError: item.last_error ? String(item.last_error) : undefined,
    lastUsedAt: item.last_used_at ? String(item.last_used_at) : undefined,
    createdAt: String(item.created_at),
    updatedAt: String(item.updated_at),
  };
};

export const testProvider = async (providerId: string, modelName: string, apiKey: string, baseUrl?: string): Promise<void> => {
  const response = await apiFetch("/api/providers/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider_id: providerId,
      model_name: modelName,
      api_key: apiKey,
      base_url: baseUrl,
    }),
  });
  await parseResponse(response);
};

export const startDeviceAuth = async (providerId: string): Promise<{ deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number }> => {
  const response = await apiFetch(`/api/providers/${providerId}/auth/start`, {
    method: "POST",
  });
  const payload = await parseResponse(response);
  const data = payload?.data ?? {};
  return {
    deviceCode: String(data.device_code),
    userCode: String(data.user_code),
    verificationUri: String(data.verification_uri),
    expiresIn: Number(data.expires_in),
    interval: Number(data.interval),
  };
};

export const pollDeviceAuth = async (providerId: string, deviceCode: string): Promise<{ accessToken: string }> => {
  const response = await apiFetch(`/api/providers/${providerId}/auth/poll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      device_code: deviceCode,
    }),
  });
  const payload = await parseResponse(response);
  return {
    accessToken: String(payload?.data?.access_token ?? ""),
  };
};

export const storeApiKey = async (providerId: string, apiKey: string): Promise<{ credentialId: string }> => {
    const response = await apiFetch(`/api/providers/${providerId}/auth/api`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            api_key: apiKey,
        }),
    });
    const payload = await parseResponse(response);
    return {
        credentialId: String(payload?.data?.credential_id ?? ""),
    };
};
