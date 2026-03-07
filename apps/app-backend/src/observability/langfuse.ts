/**
 * Langfuse Client Initialization
 *
 * Provides the Langfuse SDK client instance for observability.
 */

import { Langfuse } from "langfuse";

// Environment variables for Langfuse configuration
const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;
const LANGFUSE_HOST = process.env.LANGFUSE_HOST || "https://cloud.langfuse.com";
const LANGFUSE_ENABLED = process.env.LANGFUSE_ENABLED !== "false";

let langfuseInstance: Langfuse | null = null;

/**
 * Get or create the Langfuse client instance
 */
export function getLangfuse(): Langfuse | null {
  if (!LANGFUSE_ENABLED) {
    return null;
  }

  if (!LANGFUSE_PUBLIC_KEY || !LANGFUSE_SECRET_KEY) {
    console.warn(
      "[Langfuse] Missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY, observability disabled",
    );
    return null;
  }

  if (!langfuseInstance) {
    langfuseInstance = new Langfuse({
      publicKey: LANGFUSE_PUBLIC_KEY,
      secretKey: LANGFUSE_SECRET_KEY,
      baseUrl: LANGFUSE_HOST,
      flushAt: 10, // Send after 10 events
      flushInterval: 5000, // Or every 5 seconds
    });

    console.log(`[Langfuse] Initialized with host: ${LANGFUSE_HOST}`);
  }

  return langfuseInstance;
}

/**
 * Shutdown Langfuse client gracefully
 */
export async function shutdownLangfuse(): Promise<void> {
  if (langfuseInstance) {
    await langfuseInstance.shutdownAsync();
    langfuseInstance = null;
    console.log("[Langfuse] Shutdown complete");
  }
}

/**
 * Check if Langfuse is enabled and configured
 */
export function isLangfuseEnabled(): boolean {
  return LANGFUSE_ENABLED && !!LANGFUSE_PUBLIC_KEY && !!LANGFUSE_SECRET_KEY;
}
