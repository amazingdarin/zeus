/**
 * LLM Provider Configuration API Client
 */

import { apiFetch } from "../config/api";

/**
 * LLM Provider IDs
 */
export type LLMProviderId = "openai" | "anthropic" | "google" | "ollama" | "openai-compatible";

/**
 * Provider configuration status
 */
export type ProviderConfigStatus = "active" | "error" | "unknown";

/**
 * Provider configuration as returned by API
 */
export type ProviderConfig = {
  id: string;
  providerId: LLMProviderId;
  displayName: string;
  baseUrl?: string;
  defaultModel?: string;
  apiKeyMasked?: string;
  enabled: boolean;
  status: ProviderConfigStatus;
  lastError?: string;
  lastTestedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Input for creating/updating a provider configuration
 */
export type ProviderConfigInput = {
  providerId: LLMProviderId;
  displayName: string;
  baseUrl?: string;
  defaultModel?: string;
  apiKey?: string;
  enabled?: boolean;
};

/**
 * Provider type definition (static info)
 */
export type ProviderType = {
  id: LLMProviderId;
  name: string;
  description: string;
  requiresApiKey: boolean;
  supportsBaseUrl: boolean;
  requiresBaseUrl?: boolean;
  defaultBaseUrl?: string;
  defaultModels: string[];
  dynamicModels?: boolean;
};

/**
 * Ollama model info
 */
export type OllamaModel = {
  id: string;
  name: string;
  size: number;
  modifiedAt: string;
};

/**
 * Test result
 */
export type TestResult = {
  success: boolean;
  model: string;
  response?: string;
};

/**
 * Parse API response
 */
async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || payload?.error || "Request failed";
    throw new Error(message);
  }
  return payload?.data as T;
}

/**
 * List all provider configurations
 */
export async function listConfigs(): Promise<ProviderConfig[]> {
  const response = await apiFetch("/api/llm/configs");
  return parseResponse<ProviderConfig[]>(response);
}

/**
 * Get a single provider configuration
 */
export async function getConfig(id: string): Promise<ProviderConfig> {
  const response = await apiFetch(`/api/llm/configs/${encodeURIComponent(id)}`);
  return parseResponse<ProviderConfig>(response);
}

/**
 * Create a new provider configuration
 */
export async function createConfig(input: ProviderConfigInput): Promise<ProviderConfig> {
  const response = await apiFetch("/api/llm/configs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse<ProviderConfig>(response);
}

/**
 * Update a provider configuration
 */
export async function updateConfig(
  id: string,
  input: Partial<ProviderConfigInput>,
): Promise<ProviderConfig> {
  const response = await apiFetch(`/api/llm/configs/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse<ProviderConfig>(response);
}

/**
 * Delete a provider configuration
 */
export async function deleteConfig(id: string): Promise<void> {
  const response = await apiFetch(`/api/llm/configs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await parseResponse<{ deleted: boolean }>(response);
}

/**
 * Test a provider configuration
 */
export async function testConfig(id: string): Promise<TestResult> {
  const response = await apiFetch(`/api/llm/configs/${encodeURIComponent(id)}/test`, {
    method: "POST",
  });
  return parseResponse<TestResult>(response);
}

/**
 * Get available provider types
 */
export async function getProviderTypes(): Promise<ProviderType[]> {
  const response = await apiFetch("/api/llm/provider-types");
  return parseResponse<ProviderType[]>(response);
}

/**
 * Fetch models from Ollama
 */
export async function fetchOllamaModels(baseUrl: string): Promise<OllamaModel[]> {
  const response = await apiFetch(`/api/llm/ollama/models?baseUrl=${encodeURIComponent(baseUrl)}`);
  return parseResponse<OllamaModel[]>(response);
}
