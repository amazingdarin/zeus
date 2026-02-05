import fetch from "node-fetch";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type FetchUrlResult = {
  url: string;
  html: string;
  fetched_at: string;
};

export const fetchUrl = async (_userId: string, _projectKey: string, url: string): Promise<FetchUrlResult> => {
  const target = url.trim();
  if (!target) {
    throw new Error("url is required");
  }
  const response = await fetch(target, {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`fetch failed with status ${response.status}`);
  }
  const html = await response.text();
  if (!html.trim()) {
    throw new Error("empty html");
  }
  return {
    url: response.url || target,
    html,
    fetched_at: new Date().toISOString(),
  };
};
