/**
 * Chat Settings API Client
 */

import { apiFetch } from "../config/api";

export type ChatSettings = {
  fullAccess: boolean;
};

/**
 * Get current chat settings
 */
export async function getChatSettings(): Promise<ChatSettings> {
  const res = await apiFetch("/api/settings/chat");
  if (!res.ok) {
    throw new Error("Failed to get chat settings");
  }
  const json = await res.json();
  return json.data ?? json;
}

/**
 * Update chat settings
 */
export async function updateChatSettings(
  input: Partial<ChatSettings>,
): Promise<ChatSettings> {
  const res = await apiFetch("/api/settings/chat", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      full_access: input.fullAccess,
    }),
  });
  if (!res.ok) {
    throw new Error("Failed to update chat settings");
  }
  const json = await res.json();
  return json.data ?? json;
}
