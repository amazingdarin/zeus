import { apiFetch } from "../config/api";

export type ModelRuntime = {
  id: string;
  scenario: string;
  name: string;
  baseUrl: string;
  modelName: string;
  parameters: Record<string, unknown> | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type ModelRuntimeInput = {
  scenario: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  parameters: Record<string, unknown> | null;
  isActive: boolean;
};

const parseResponse = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || payload?.error || "Request failed";
    throw new Error(message);
  }
  return payload;
};

export const fetchModelRuntimes = async (): Promise<ModelRuntime[]> => {
  const response = await apiFetch("/api/model-runtimes");
  const payload = await parseResponse(response);
  const items = Array.isArray(payload?.data) ? payload.data : [];
  return items.map((item: any) => ({
    id: String(item.id ?? ""),
    scenario: String(item.scenario ?? ""),
    name: String(item.name ?? ""),
    baseUrl: String(item.base_url ?? ""),
    modelName: String(item.model_name ?? ""),
    parameters: item.parameters ?? null,
    isActive: Boolean(item.is_active ?? false),
    createdAt: item.created_at ?? item.createdAt ?? undefined,
    updatedAt: item.updated_at ?? item.updatedAt ?? undefined,
  }));
};

export const upsertModelRuntime = async (input: ModelRuntimeInput): Promise<ModelRuntime> => {
  const response = await apiFetch("/api/model-runtimes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scenario: input.scenario,
      name: input.name,
      base_url: input.baseUrl,
      api_key: input.apiKey,
      model_name: input.modelName,
      parameters: input.parameters ?? {},
      is_active: input.isActive,
    }),
  });
  const payload = await parseResponse(response);
  const item = payload?.data ?? {};
  return {
    id: String(item.id ?? ""),
    scenario: String(item.scenario ?? input.scenario),
    name: String(item.name ?? input.name),
    baseUrl: String(item.base_url ?? input.baseUrl),
    modelName: String(item.model_name ?? input.modelName),
    parameters: item.parameters ?? input.parameters ?? null,
    isActive: Boolean(item.is_active ?? input.isActive),
    createdAt: item.created_at ?? item.createdAt ?? undefined,
    updatedAt: item.updated_at ?? item.updatedAt ?? undefined,
  };
};

export const refreshRuntimeModels = async (baseUrl: string, apiKey: string): Promise<string[]> => {
  const response = await apiFetch("/api/model-runtimes/models:refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base_url: baseUrl,
      api_key: apiKey,
    }),
  });
  const payload = await parseResponse(response);
  const items = Array.isArray(payload?.data) ? payload.data : [];
  return items.map((item: any) => String(item));
};

export const testRuntime = async (
  scenario: string,
  baseUrl: string,
  apiKey: string,
  modelName: string,
): Promise<void> => {
  const response = await apiFetch("/api/model-runtimes/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      scenario,
      base_url: baseUrl,
      api_key: apiKey,
      model_name: modelName,
    }),
  });
  await parseResponse(response);
};
