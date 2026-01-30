export type FetchUrlFallback = (projectKey: string, url: string) => Promise<{ html: string; url: string }>;

export const fetchUrlHtmlWithFallback = async (
  projectKey: string,
  url: string,
  fallback: FetchUrlFallback,
): Promise<{ html: string; url: string }> => {
  try {
    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
    });
    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}`);
    }
    const html = await response.text();
    if (!html.trim()) {
      throw new Error("Empty HTML response");
    }
    return { html, url: response.url || url };
  } catch {
    return fallback(projectKey, url);
  }
};
