import { apiFetch } from "../config/api";

/**
 * PPT Generation API Client
 */

/**
 * Style options for PPT generation
 */
export type PPTStyleOptions = {
  description?: string;
  templateId?: string;
  templateImages?: string[];
};

/**
 * Generation options
 */
export type PPTGenerateOptions = {
  aspectRatio?: "16:9" | "4:3";
  language?: string;
};

/**
 * Export PPT request
 */
export type ExportPPTRequest = {
  style?: PPTStyleOptions;
  options?: PPTGenerateOptions;
};

/**
 * Export PPT response
 */
export type ExportPPTResponse = {
  task_id: string;
  status: string;
};

/**
 * PPT task status
 */
export type PPTTaskStatus = {
  task_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress?: number;
  current_slide?: number;
  total_slides?: number;
  error?: string;
  created_at?: string;
  updated_at?: string;
};

/**
 * Preset template
 */
export type PresetTemplate = {
  id: string;
  name: string;
  description: string;
  previewUrl?: string;
};

/**
 * Custom template
 */
export type CustomTemplate = {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  templateImages?: string[];
  colorScheme?: {
    primary: string;
    secondary: string;
    background: string;
    text: string;
    accent?: string;
  };
};

/**
 * All templates response
 */
export type AllTemplatesResponse = {
  presets: PresetTemplate[];
  custom: CustomTemplate[];
};

/**
 * PPT service status
 */
export type PPTServiceStatus = {
  available: boolean;
};

/**
 * Export document to PPT
 */
export const exportToPPT = async (
  projectKey: string,
  docId: string,
  request?: ExportPPTRequest
): Promise<ExportPPTResponse> => {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(docId)}/export-ppt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request || {}),
    }
  );

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Failed to export PPT");
  }

  const payload = await response.json();
  return payload?.data ?? payload;
};

/**
 * Get PPT task status
 */
export const getPPTTaskStatus = async (
  projectKey: string,
  taskId: string
): Promise<PPTTaskStatus> => {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/ppt-tasks/${encodeURIComponent(taskId)}`
  );

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Failed to get task status");
  }

  const payload = await response.json();
  return payload?.data ?? payload;
};

/**
 * Download generated PPTX file
 */
export const downloadPPTX = async (
  projectKey: string,
  taskId: string,
  filename?: string
): Promise<void> => {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/ppt-tasks/${encodeURIComponent(taskId)}/download`
  );

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Failed to download PPTX");
  }

  // Create blob and trigger download
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `presentation-${taskId}.pptx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};

/**
 * Get slide previews
 */
export const getPPTPreview = async (
  projectKey: string,
  taskId: string
): Promise<string[]> => {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/ppt-tasks/${encodeURIComponent(taskId)}/previews`
  );

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  return payload?.data?.previews ?? [];
};

/**
 * Modify a slide using natural language
 */
export const modifySlide = async (
  projectKey: string,
  taskId: string,
  slideIndex: number,
  instruction: string
): Promise<ExportPPTResponse> => {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/ppt-tasks/${encodeURIComponent(taskId)}/modify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slide_index: slideIndex, instruction }),
    }
  );

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Failed to modify slide");
  }

  const payload = await response.json();
  return payload?.data ?? payload;
};

/**
 * Get preset templates
 */
export const getPresetTemplates = async (): Promise<PresetTemplate[]> => {
  const response = await apiFetch("/api/ppt-templates");

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  return payload?.data?.templates ?? [];
};

/**
 * Get all templates (preset + custom) for a project
 */
export const getAllTemplates = async (
  projectKey: string
): Promise<AllTemplatesResponse> => {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/ppt-templates`
  );

  if (!response.ok) {
    return { presets: [], custom: [] };
  }

  const payload = await response.json();
  return payload?.data ?? { presets: [], custom: [] };
};

/**
 * Create a custom template
 */
export const createCustomTemplate = async (
  projectKey: string,
  template: {
    name: string;
    description?: string;
    preview_url?: string;
    template_images?: string[];
    color_scheme?: {
      primary?: string;
      secondary?: string;
      background?: string;
      text?: string;
      accent?: string;
    };
  }
): Promise<CustomTemplate> => {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/ppt-templates`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(template),
    }
  );

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Failed to create template");
  }

  const payload = await response.json();
  return payload?.data ?? payload;
};

/**
 * Delete a custom template
 */
export const deleteCustomTemplate = async (
  projectKey: string,
  templateId: string
): Promise<void> => {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/ppt-templates/${encodeURIComponent(templateId)}`,
    { method: "DELETE" }
  );

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Failed to delete template");
  }
};

/**
 * Check PPT service availability
 */
export const getPPTServiceStatus = async (): Promise<PPTServiceStatus> => {
  const response = await apiFetch("/api/ppt-service/status");

  if (!response.ok) {
    return { available: false };
  }

  const payload = await response.json();
  return payload?.data ?? { available: false };
};

/**
 * Poll task status until completion or failure
 */
export const pollTaskStatus = async (
  projectKey: string,
  taskId: string,
  onProgress?: (status: PPTTaskStatus) => void,
  intervalMs = 2000,
  timeoutMs = 300000 // 5 minutes
): Promise<PPTTaskStatus> => {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const status = await getPPTTaskStatus(projectKey, taskId);
    onProgress?.(status);

    if (status.status === "completed" || status.status === "failed") {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("PPT generation timed out");
};
