import fetch from "node-fetch";

const CORE_BASE_URL = (process.env.CORE_API_BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");

export type CoreDocumentMeta = {
  title: string;
  parent_id: string;
  slug?: string;
  extra?: Record<string, unknown>;
};

export type CoreDocumentBody = {
  type: string;
  content: unknown;
};

export type CoreDocumentResponse = {
  meta?: { id?: string; title?: string };
  id?: string;
  title?: string;
};

export const createCoreDocument = async (
  projectKey: string,
  meta: CoreDocumentMeta,
  body: CoreDocumentBody,
): Promise<CoreDocumentResponse> => {
  const response = await fetch(`${CORE_BASE_URL}/api/projects/${encodeURIComponent(projectKey)}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meta, body }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "core create failed");
  }
  const payload = await response.json().catch(() => null);
  return payload?.data ?? payload ?? {};
};
