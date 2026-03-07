import { apiFetch } from "../config/api";
import type { User } from "./auth";

export type UpdateUserProfileInput = {
  display_name?: string;
  avatar_url?: string;
  username?: string;
  language?: string;
};

export async function updateCurrentUserProfile(input: UpdateUserProfileInput): Promise<User> {
  const body: Record<string, unknown> = {};
  if (typeof input.display_name === "string") {
    body.display_name = input.display_name;
  }
  if (typeof input.avatar_url === "string") {
    body.avatar_url = input.avatar_url;
  }
  if (typeof input.username === "string") {
    body.username = input.username;
  }
  if (typeof input.language === "string") {
    body.language = input.language;
  }

  const response = await apiFetch("/api/users/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to update user profile");
  }
  return response.json();
}
