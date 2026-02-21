/**
 * PPT Generation Service
 *
 * Main service for generating PPT files from Zeus documents.
 * Integrates with Banana Slides for AI-powered PPT generation.
 */

import type { JSONContent } from "@tiptap/core";
import { getBananaSlidesClient } from "./banana-client.js";
import { convertTiptapToSlides, validatePPTDocument } from "./tiptap-converter.js";
import type {
  SlideContent,
  StyleOptions,
  GenerateOptions,
  GenerateResult,
  TaskStatus,
} from "./types.js";

// Re-export types and utilities
export * from "./types.js";
export * from "./banana-client.js";
export * from "./tiptap-converter.js";

/**
 * PPT Generation Service
 */
export const pptService = {
  /**
   * Generate PPT from a Tiptap document
   *
   * @param doc - Tiptap JSON document (with horizontalRule separators)
   * @param style - Style options for the PPT
   * @param options - Additional generation options
   * @returns Generation result with task ID
   */
  async generateFromDocument(
    doc: JSONContent,
    style?: StyleOptions,
    options?: GenerateOptions
  ): Promise<GenerateResult> {
    // Validate the document
    const validation = validatePPTDocument(doc);
    if (!validation.valid) {
      throw new Error(`Invalid PPT document: ${validation.errors.join(", ")}`);
    }

    // Convert Tiptap to slides
    const slides = convertTiptapToSlides(doc);

    if (slides.length === 0) {
      throw new Error("No slides could be extracted from the document");
    }

    // Generate PPT
    const client = getBananaSlidesClient();
    return client.generateFromSlides(slides, style, options);
  },

  /**
   * Generate PPT from pre-extracted slide contents
   *
   * @param slides - Array of slide contents
   * @param style - Style options for the PPT
   * @param options - Additional generation options
   * @returns Generation result with task ID
   */
  async generateFromSlides(
    slides: SlideContent[],
    style?: StyleOptions,
    options?: GenerateOptions
  ): Promise<GenerateResult> {
    if (slides.length === 0) {
      throw new Error("At least one slide is required");
    }

    if (slides.length > 100) {
      throw new Error("Maximum 100 slides allowed");
    }

    const client = getBananaSlidesClient();
    return client.generateFromSlides(slides, style, options);
  },

  /**
   * Generate PPT from an uploaded file
   *
   * @param file - File buffer (PDF, DOCX, etc.)
   * @param filename - Original filename
   * @param style - Style options for the PPT
   * @returns Generation result with task ID
   */
  async generateFromFile(
    file: Buffer,
    filename: string,
    style?: StyleOptions
  ): Promise<GenerateResult> {
    const client = getBananaSlidesClient();
    return client.generateFromFile(file, filename, style);
  },

  /**
   * Get the status of a PPT generation task
   *
   * @param taskId - Task ID from generation request
   * @returns Current task status
   */
  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const client = getBananaSlidesClient();
    return client.getStatus(taskId);
  },

  /**
   * Download the generated PPTX file
   *
   * @param taskId - Task ID of completed generation
   * @returns PPTX file as Buffer
   */
  async downloadPPTX(taskId: string): Promise<Buffer> {
    const client = getBananaSlidesClient();

    // Check status first
    const status = await client.getStatus(taskId);
    if (status.status !== "completed") {
      throw new Error(
        `Cannot download: task status is ${status.status}${status.error ? ` (${status.error})` : ""}`
      );
    }

    return client.downloadPPTX(taskId);
  },

  /**
   * Get preview images for generated slides
   *
   * @param taskId - Task ID of generation
   * @returns Array of preview image URLs
   */
  async getPreviews(taskId: string): Promise<string[]> {
    const client = getBananaSlidesClient();
    return client.getPreviews(taskId);
  },

  /**
   * Modify a specific slide using natural language
   *
   * @param pptId - ID of the generated PPT
   * @param slideIndex - Index of the slide to modify
   * @param instruction - Natural language instruction
   * @returns New generation result
   */
  async modifySlide(
    pptId: string,
    slideIndex: number,
    instruction: string
  ): Promise<GenerateResult> {
    const client = getBananaSlidesClient();
    return client.modifySlide(pptId, slideIndex, instruction);
  },

  /**
   * Check if the PPT generation service is available
   *
   * @returns True if service is healthy
   */
  async isAvailable(): Promise<boolean> {
    const client = getBananaSlidesClient();
    return client.healthCheck();
  },
};

export default pptService;
