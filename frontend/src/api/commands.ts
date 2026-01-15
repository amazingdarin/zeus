import { apiFetch } from "../config/api";

export type CommandArtifact = {
  type: string;
  title?: string;
  data?: Record<string, unknown>;
};

export type CommandResult = {
  message: string;
  artifacts: CommandArtifact[];
};

type CommandResponse = {
  code: string;
  message: string;
  data?: CommandResult;
};

export async function executeCommand(
  projectKey: string,
  input: string,
): Promise<CommandResult> {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/commands`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    },
  );
  if (!response.ok) {
    throw new Error(`command failed: ${response.status}`);
  }
  const payload = (await response.json()) as CommandResponse;
  if (!payload?.data) {
    return { message: "", artifacts: [] };
  }
  return payload.data;
}
