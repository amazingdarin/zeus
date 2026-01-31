/**
 * OCR API Client
 *
 * Functions to interact with the OCR service
 */

import { apiFetch } from "../config/api";
import type { JSONContent } from "@tiptap/react";

export type OCROutputFormat = "tiptap" | "markdown";

export type OCRRequest = {
  image: string; // base64 data URL or HTTP URL
  outputFormat?: OCROutputFormat;
  language?: string;
};

export type OCRResponse = {
  content: JSONContent;
  markdown?: string;
};

/**
 * Parse image using OCR with vision LLM
 */
export async function parseImage(request: OCRRequest): Promise<OCRResponse> {
  const response = await apiFetch("/api/ocr/parse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image: request.image,
      output_format: request.outputFormat,
      language: request.language,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "OCR failed");
  }

  const payload = await response.json();
  return payload?.data ?? {};
}

/**
 * Check if vision OCR is available
 */
export async function isOCRAvailable(): Promise<boolean> {
  try {
    const response = await apiFetch("/api/ocr/available");
    if (!response.ok) {
      return false;
    }
    const payload = await response.json();
    return payload?.data?.available ?? false;
  } catch {
    return false;
  }
}

/**
 * Convert a File to a base64 data URL
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read file as data URL"));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Perform OCR on a File
 */
export async function ocrFile(
  file: File,
  options?: { outputFormat?: OCROutputFormat; language?: string }
): Promise<OCRResponse> {
  const dataUrl = await fileToDataUrl(file);
  return parseImage({
    image: dataUrl,
    outputFormat: options?.outputFormat,
    language: options?.language,
  });
}

export const ocrApi = {
  parseImage,
  isOCRAvailable,
  fileToDataUrl,
  ocrFile,
};
