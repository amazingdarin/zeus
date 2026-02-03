/**
 * Web Search Configuration API
 */

import { apiFetch } from "../config/api";

export type WebSearchProvider = "tavily" | "serpapi" | "duckduckgo";

export type WebSearchConfig = {
  id: string;
  provider: WebSearchProvider;
  apiKeyMasked?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WebSearchConfigInput = {
  provider: WebSearchProvider;
  apiKey?: string;
  enabled?: boolean;
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

/**
 * Get web search configuration
 */
export async function getWebSearchConfig(): Promise<WebSearchConfig | null> {
  const response = await apiFetch("/api/settings/web-search");
  if (!response.ok) {
    throw new Error("Failed to get web search config");
  }
  const payload = await response.json();
  return payload?.data || null;
}

/**
 * Set (upsert) web search configuration
 */
export async function setWebSearchConfig(
  input: WebSearchConfigInput,
): Promise<WebSearchConfig> {
  const response = await apiFetch("/api/settings/web-search", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: input.provider,
      api_key: input.apiKey,
      enabled: input.enabled,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to set web search config");
  }
  const payload = await response.json();
  return payload?.data;
}

/**
 * Delete web search configuration
 */
export async function deleteWebSearchConfig(): Promise<void> {
  const response = await apiFetch("/api/settings/web-search", {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error("Failed to delete web search config");
  }
}

/**
 * Test web search
 */
export async function testWebSearch(
  query?: string,
): Promise<WebSearchResult[]> {
  const response = await apiFetch("/api/settings/web-search/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: query || "test search" }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Web search test failed");
  }
  const payload = await response.json();
  return payload?.data?.results || [];
}

/**
 * Provider display info
 */
export const WEB_SEARCH_PROVIDERS: Array<{
  id: WebSearchProvider;
  name: string;
  description: string;
  requiresApiKey: boolean;
  website: string;
}> = [
  {
    id: "tavily",
    name: "Tavily",
    description: "专为 AI 优化的搜索 API，结果质量高",
    requiresApiKey: true,
    website: "https://tavily.com/",
  },
  {
    id: "serpapi",
    name: "SerpAPI",
    description: "Google 搜索 API，功能全面",
    requiresApiKey: true,
    website: "https://serpapi.com/",
  },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    description: "免费搜索，无需 API 密钥，功能有限",
    requiresApiKey: false,
    website: "https://duckduckgo.com/",
  },
];
