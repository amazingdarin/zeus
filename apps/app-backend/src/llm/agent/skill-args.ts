import { zodObjectToOpenAIParameters } from "../zod.js";
import type { AgentSkillDefinition } from "./types.js";

export type SkillArgsValidationIssue = {
  path: string;
  message: string;
};

export type SkillArgsValidationError = {
  message: string;
  missing?: string[];
  issues?: SkillArgsValidationIssue[];
};

export type NormalizeAndValidateResult =
  | { ok: true; args: Record<string, unknown>; docIds: string[] }
  | { ok: false; error: SkillArgsValidationError };

function isMissingValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

function getRequiredKeys(skill: AgentSkillDefinition): string[] {
  try {
    return zodObjectToOpenAIParameters(skill.inputSchema).required || [];
  } catch {
    // If conversion fails for any reason, fall back to "no required keys"
    // and let zod validation handle it.
    return [];
  }
}

function requiresDocScope(skill: AgentSkillDefinition, requiredKeys: string[]): boolean {
  const meta = skill.metadata as Record<string, unknown> | undefined;
  if (meta && meta.requiresDocScope === true) return true;
  return requiredKeys.includes("doc_id");
}

function formatIssues(issues: SkillArgsValidationIssue[]): string {
  return issues
    .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
    .join("; ");
}

/**
 * Normalize + validate tool-call arguments for a skill execution.
 *
 * Normalization rules:
 * - If the skill requires doc scope and `docIds` is present, inject `doc_id`
 *   into args for schema validation / downstream tools.
 * - If args contains a doc_id and docIds is empty, mirror it into docIds.
 *
 * Validation rules:
 * - Missing required keys are detected via schema-derived "required" list.
 * - Type-level validation is performed via `inputSchema.safeParse()`.
 */
export function normalizeAndValidateSkillArgs(
  skill: AgentSkillDefinition,
  rawArgs: Record<string, unknown>,
  rawDocIds: string[],
): NormalizeAndValidateResult {
  const requiredKeys = getRequiredKeys(skill);

  const args: Record<string, unknown> = { ...(rawArgs || {}) };
  let docIds: string[] = Array.isArray(rawDocIds) ? [...rawDocIds] : [];

  if (requiresDocScope(skill, requiredKeys)) {
    const docIdFromArgs = typeof args.doc_id === "string" ? args.doc_id.trim() : "";
    const docIdFromContext = docIds.length > 0 ? String(docIds[0] || "").trim() : "";
    const docId = docIdFromArgs || docIdFromContext;

    if (docId) {
      if (!docIdFromArgs) args.doc_id = docId;
      if (!docIdFromContext) docIds = [docId];
    }
  }

  const missing = requiredKeys.filter((k) => isMissingValue(args[k]));
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        message: `缺少必要参数: ${missing.join(", ")}`,
        missing,
      },
    };
  }

  const parsed = skill.inputSchema.safeParse(args) as
    | { success: true; data: unknown }
    | { success: false; error: unknown };

  if (!parsed.success) {
    const rawIssues = (parsed.error as any)?.issues;
    const issues: SkillArgsValidationIssue[] = Array.isArray(rawIssues)
      ? rawIssues
          .slice(0, 5)
          .map((i: any) => ({
            path: Array.isArray(i.path) ? i.path.join(".") : "",
            message: typeof i.message === "string" ? i.message : "Invalid input",
          }))
      : [];

    return {
      ok: false,
      error: {
        message: issues.length > 0 ? `参数校验失败: ${formatIssues(issues)}` : "参数校验失败",
        issues: issues.length > 0 ? issues : undefined,
      },
    };
  }

  const data = parsed.data;
  if (typeof data !== "object" || data === null) {
    return {
      ok: false,
      error: { message: "参数校验失败: 非对象入参" },
    };
  }

  return {
    ok: true,
    args: data as Record<string, unknown>,
    docIds,
  };
}

