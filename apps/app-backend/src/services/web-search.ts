/**
 * Web Search Service
 *
 * Provides web search capabilities using configurable search APIs.
 * Supported providers:
 * - Tavily: AI-optimized search API
 * - SerpAPI: Full-featured Google search API
 * - DuckDuckGo: Free, privacy-focused search (via unofficial API)
 */

import { query } from "../db/postgres.js";
import { decrypt } from "../utils/crypto.js";

// ============================================================================
// Types
// ============================================================================

export type WebSearchProvider = "tavily" | "serpapi" | "duckduckgo";

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source?: string;
};

export type WebSearchOptions = {
  limit?: number;
  lang?: string;
};

export type WebSearchConfig = {
  provider: WebSearchProvider;
  apiKey?: string;
  enabled: boolean;
};

// ============================================================================
// Configuration
// ============================================================================

type WebSearchConfigRow = {
  provider: string;
  api_key_cipher: string | null;
  api_key_iv: string | null;
  enabled: boolean;
};

let configCache: { config: WebSearchConfig | null; timestamp: number } | null = null;
const CONFIG_CACHE_TTL = 60 * 1000; // 1 minute

async function getWebSearchConfig(): Promise<WebSearchConfig | null> {
  if (configCache && Date.now() - configCache.timestamp < CONFIG_CACHE_TTL) {
    return configCache.config;
  }

  try {
    const result = await query<WebSearchConfigRow>(
      `SELECT provider, api_key_cipher, api_key_iv, enabled 
       FROM web_search_config 
       LIMIT 1`,
    );

    if (result.rows.length === 0) {
      configCache = { config: null, timestamp: Date.now() };
      return null;
    }

    const row = result.rows[0];
    let apiKey: string | undefined;

    if (row.api_key_cipher && row.api_key_iv) {
      try {
        apiKey = decrypt(row.api_key_cipher, row.api_key_iv);
      } catch {
        console.warn("[web-search] Failed to decrypt API key");
      }
    }

    const config: WebSearchConfig = {
      provider: row.provider as WebSearchProvider,
      apiKey,
      enabled: row.enabled,
    };

    configCache = { config, timestamp: Date.now() };
    return config;
  } catch (err) {
    // Table might not exist yet
    console.warn("[web-search] Config table not available:", err);
    configCache = { config: null, timestamp: Date.now() };
    return null;
  }
}

export function clearWebSearchConfigCache(): void {
  configCache = null;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Search the web for information
 */
export async function webSearch(
  searchQuery: string,
  options: WebSearchOptions = {},
): Promise<WebSearchResult[]> {
  const config = await getWebSearchConfig();

  if (!config?.enabled) {
    throw new Error("Web search is not configured or disabled");
  }

  const { limit = 5, lang = "zh" } = options;

  switch (config.provider) {
    case "tavily":
      return searchWithTavily(searchQuery, config.apiKey!, limit);

    case "serpapi":
      return searchWithSerpAPI(searchQuery, config.apiKey!, limit, lang);

    case "duckduckgo":
      return searchWithDuckDuckGo(searchQuery, limit);

    default:
      throw new Error(`Unknown web search provider: ${config.provider}`);
  }
}

/**
 * Check if web search is available
 */
export async function isWebSearchAvailable(): Promise<boolean> {
  const config = await getWebSearchConfig();
  return config?.enabled === true;
}

// ============================================================================
// Provider Implementations
// ============================================================================

/**
 * Search using Tavily API
 * https://tavily.com/
 */
async function searchWithTavily(
  searchQuery: string,
  apiKey: string,
  limit: number,
): Promise<WebSearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query: searchQuery,
      max_results: limit,
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Tavily API error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    results: Array<{
      title: string;
      url: string;
      content: string;
      score: number;
    }>;
  };

  return data.results.map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content.slice(0, 300),
    source: "tavily",
  }));
}

/**
 * Search using SerpAPI
 * https://serpapi.com/
 */
async function searchWithSerpAPI(
  searchQuery: string,
  apiKey: string,
  limit: number,
  lang: string,
): Promise<WebSearchResult[]> {
  const params = new URLSearchParams({
    api_key: apiKey,
    q: searchQuery,
    num: String(limit),
    hl: lang,
    engine: "google",
  });

  const response = await fetch(`https://serpapi.com/search?${params}`);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`SerpAPI error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as {
    organic_results?: Array<{
      title: string;
      link: string;
      snippet: string;
    }>;
  };

  if (!data.organic_results) {
    return [];
  }

  return data.organic_results.slice(0, limit).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    source: "google",
  }));
}

/**
 * Search using DuckDuckGo (unofficial API)
 * Note: This is a free alternative but may be less reliable
 */
async function searchWithDuckDuckGo(
  searchQuery: string,
  limit: number,
): Promise<WebSearchResult[]> {
  // DuckDuckGo doesn't have an official API, using instant answer API
  const params = new URLSearchParams({
    q: searchQuery,
    format: "json",
    no_redirect: "1",
    skip_disambig: "1",
  });

  const response = await fetch(`https://api.duckduckgo.com/?${params}`);

  if (!response.ok) {
    throw new Error(`DuckDuckGo API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    AbstractSource?: string;
    RelatedTopics?: Array<{
      Text?: string;
      FirstURL?: string;
    }>;
  };

  const results: WebSearchResult[] = [];

  // Add abstract if available
  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.AbstractSource || "DuckDuckGo",
      url: data.AbstractURL,
      snippet: data.AbstractText,
      source: "duckduckgo",
    });
  }

  // Add related topics
  if (data.RelatedTopics) {
    for (const topic of data.RelatedTopics) {
      if (results.length >= limit) break;
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.split(" - ")[0] || topic.Text.slice(0, 50),
          url: topic.FirstURL,
          snippet: topic.Text,
          source: "duckduckgo",
        });
      }
    }
  }

  return results.slice(0, limit);
}
