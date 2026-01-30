import { apiFetch } from "../config/api";

export type ConvertResponse = {
  content: string;
  output_type?: string;
};

export const convertDocument = async (
  projectKey: string,
  file: File,
  from: string,
  to: string,
): Promise<ConvertResponse> => {
  const params = new URLSearchParams({ from, to });
  const form = new FormData();
  form.append("file", file);

  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/convert?${params.toString()}`,
    { method: "POST", body: form },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Convert failed");
  }
  const payload = await response.json();
  const data = payload?.data ?? payload;
  return {
    content: String(data?.content ?? ""),
    output_type: data?.output_type ? String(data.output_type) : undefined,
  };
};
