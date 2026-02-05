/**
 * Banana Slides API Client
 *
 * Client for communicating with the Banana Slides PPT generation service.
 */

import type {
  SlideContent,
  StyleOptions,
  GenerateOptions,
  GenerateResult,
  TaskStatus,
  TaskStatusType,
  BananaSlideInput,
  BananaGenerateRequest,
  BananaGenerateResponse,
  BananaTaskStatusResponse,
} from "./types.js";

/**
 * Configuration for BananaSlidesClient
 */
export interface BananaSlidesConfig {
  /** Base URL of the Banana Slides API */
  baseUrl: string;
  /** API key for authentication */
  apiKey?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Banana Slides API Client
 *
 * Handles communication with the Banana Slides PPT generation service.
 */
export class BananaSlidesClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;

  constructor(config: BananaSlidesConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 60000;
  }

  /**
   * Make an HTTP request to the Banana Slides API
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Banana Slides API error (${response.status}): ${errorText}`
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Download a file from the API
   */
  private async downloadFile(path: string): Promise<Buffer> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {};

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout * 2);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Banana Slides download error (${response.status}): ${errorText}`
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Convert SlideContent to Banana Slides input format
   */
  private convertToSlideInput(slide: SlideContent): BananaSlideInput {
    const parts: string[] = [];

    // Add title
    if (slide.title) {
      parts.push(`# ${slide.title}`);
    }

    // Add subtitle
    if (slide.subtitle) {
      parts.push(`## ${slide.subtitle}`);
    }

    // Add bullets
    if (slide.bullets && slide.bullets.length > 0) {
      parts.push("");
      for (const bullet of slide.bullets) {
        parts.push(`- ${bullet}`);
      }
    }

    // Add paragraphs
    if (slide.paragraphs && slide.paragraphs.length > 0) {
      parts.push("");
      parts.push(slide.paragraphs.join("\n\n"));
    }

    // Add code blocks
    if (slide.codeBlocks && slide.codeBlocks.length > 0) {
      parts.push("");
      for (const block of slide.codeBlocks) {
        parts.push(`\`\`\`${block.language}`);
        parts.push(block.code);
        parts.push("```");
      }
    }

    // Add images
    if (slide.images && slide.images.length > 0) {
      parts.push("");
      for (const img of slide.images) {
        parts.push(`![image](${img})`);
      }
    }

    return {
      index: slide.index,
      content: parts.join("\n"),
      notes: slide.notes,
    };
  }

  /**
   * Generate PPT from slide contents
   */
  async generateFromSlides(
    slides: SlideContent[],
    style?: StyleOptions,
    options?: GenerateOptions
  ): Promise<GenerateResult> {
    const bananaSlides = slides.map((s) => this.convertToSlideInput(s));

    const request: BananaGenerateRequest = {
      slides: bananaSlides,
      style: style
        ? {
            templateId: style.templateId,
            description: style.description,
            templateImages: style.templateImages,
          }
        : undefined,
      options: options
        ? {
            aspectRatio: options.aspectRatio,
            language: options.language,
          }
        : undefined,
    };

    const response = await this.request<BananaGenerateResponse>(
      "POST",
      "/api/generate",
      request
    );

    return {
      taskId: response.taskId,
      status: this.mapStatus(response.status),
    };
  }

  /**
   * Generate PPT from a file (PDF, DOCX, etc.)
   */
  async generateFromFile(
    file: Buffer,
    filename: string,
    style?: StyleOptions
  ): Promise<GenerateResult> {
    const url = `${this.baseUrl}/api/generate/file`;
    const formData = new FormData();

    formData.append("file", new Blob([file]), filename);

    if (style?.templateId) {
      formData.append("templateId", style.templateId);
    }
    if (style?.description) {
      formData.append("styleDescription", style.description);
    }

    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Banana Slides file upload error (${response.status}): ${errorText}`
      );
    }

    const result = (await response.json()) as BananaGenerateResponse;

    return {
      taskId: result.taskId,
      status: this.mapStatus(result.status),
    };
  }

  /**
   * Get the status of a generation task
   */
  async getStatus(taskId: string): Promise<TaskStatus> {
    const response = await this.request<BananaTaskStatusResponse>(
      "GET",
      `/api/tasks/${taskId}`
    );

    return {
      taskId: response.taskId,
      status: this.mapStatus(response.status),
      progress: response.progress,
      error: response.error,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Download the generated PPTX file
   */
  async downloadPPTX(taskId: string): Promise<Buffer> {
    return this.downloadFile(`/api/tasks/${taskId}/download`);
  }

  /**
   * Get preview images for the generated slides
   */
  async getPreviews(taskId: string): Promise<string[]> {
    const response = await this.request<BananaTaskStatusResponse>(
      "GET",
      `/api/tasks/${taskId}`
    );
    return response.previews ?? [];
  }

  /**
   * Modify a specific slide using natural language
   */
  async modifySlide(
    pptId: string,
    slideIndex: number,
    instruction: string
  ): Promise<GenerateResult> {
    const response = await this.request<BananaGenerateResponse>(
      "POST",
      `/api/tasks/${pptId}/modify`,
      {
        slideIndex,
        instruction,
      }
    );

    return {
      taskId: response.taskId,
      status: this.mapStatus(response.status),
    };
  }

  /**
   * Check if the service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request<{ status: string }>("GET", "/health");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Map Banana Slides status to our TaskStatusType
   */
  private mapStatus(status: string): TaskStatusType {
    switch (status.toLowerCase()) {
      case "pending":
      case "queued":
        return "pending";
      case "processing":
      case "running":
      case "generating":
        return "processing";
      case "completed":
      case "done":
      case "success":
        return "completed";
      case "failed":
      case "error":
        return "failed";
      default:
        return "pending";
    }
  }
}

/**
 * Create a BananaSlidesClient from environment variables
 */
export function createBananaSlidesClient(): BananaSlidesClient {
  const baseUrl = process.env.BANANA_SLIDES_URL || "http://banana-slides:8080";
  const apiKey = process.env.BANANA_SLIDES_API_KEY;

  return new BananaSlidesClient({
    baseUrl,
    apiKey,
  });
}

/**
 * Singleton instance
 */
let clientInstance: BananaSlidesClient | null = null;

/**
 * Get or create the BananaSlidesClient singleton
 */
export function getBananaSlidesClient(): BananaSlidesClient {
  if (!clientInstance) {
    clientInstance = createBananaSlidesClient();
  }
  return clientInstance;
}
