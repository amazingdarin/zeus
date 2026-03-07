import { traceManager, type TraceContext } from "../../observability/index.js";
import { inferPolicy, runDocGuard, type DocGuardPolicy } from "./doc-guard.js";
import { validatePptSlideDeck } from "./ppt-guard.js";
import type { DraftValidation, DocumentDraft, SkillStreamChunk } from "./types.js";

export function appendFeedbackToArgs(
  args: Record<string, unknown>,
  feedback: string,
): Record<string, unknown> {
  const trimmed = feedback.trim();
  if (!trimmed) {
    return args;
  }

  const keys = ["instructions", "description", "request", "input"] as const;

  for (const key of keys) {
    const current = args[key];
    if (typeof current === "string") {
      return {
        ...args,
        [key]: `${current.trimEnd()}\n\n${trimmed}`,
      };
    }
  }

  // Fallback: attach to `input` to avoid surprising a skill that doesn't use `instructions`.
  return {
    ...args,
    input: typeof args.input === "string" ? `${args.input.trimEnd()}\n\n${trimmed}` : trimmed,
  };
}

export async function* runDraftRefinementLoop(input: {
  skillLegacyName: string;
  userMessage: string;
  baseArgs: Record<string, unknown>;
  maxAttempts: number;
  runAttempt: (args: Record<string, unknown>) => AsyncGenerator<SkillStreamChunk>;
  deleteDraft: (draftId: string) => boolean;
  traceContext?: TraceContext;
}): AsyncGenerator<SkillStreamChunk> {
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts || 1));
  const policy: DocGuardPolicy = inferPolicy({
    skillLegacyName: input.skillLegacyName,
    userMessage: input.userMessage,
    args: input.baseArgs,
  });

  let args = input.baseArgs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prefix = attempt === 1 ? "正在生成草稿" : "正在修正草稿";
    yield { type: "thinking", content: `${prefix}（第 ${attempt}/${maxAttempts} 次）...` };

    let capturedDraft: DocumentDraft | null = null;
    let doneMessage: string | undefined;

    for await (const chunk of input.runAttempt(args)) {
      if (chunk.type === "thinking") {
        yield chunk;
        continue;
      }

      if (chunk.type === "delta") {
        // Suppress LLM raw JSON/markdown streaming for draft-producing skills.
        continue;
      }

      if (chunk.type === "draft") {
        if (!capturedDraft) {
          capturedDraft = chunk.draft;
        }
        continue;
      }

      if (chunk.type === "done") {
        doneMessage = chunk.message;
        continue;
      }

      if (chunk.type === "error") {
        yield chunk;
        return;
      }
    }

    if (!capturedDraft) {
      yield { type: "error", error: "技能未产生草稿输出（draft）" };
      return;
    }

    yield { type: "thinking", content: "正在进行协议与安全校验..." };

    const validateSpan = input.traceContext
      ? traceManager.startSpan(input.traceContext, "doc-guard.validate", {
          attempt,
          policy,
          skill: input.skillLegacyName,
        })
      : null;

    const guard = runDocGuard({
      policy,
      originalDoc: capturedDraft.originalContent,
      proposedDoc: capturedDraft.proposedContent,
    });

    if (validateSpan) {
      const errorCount = guard.issues.filter((i) => i.severity === "error").length;
      traceManager.endSpan(
        validateSpan,
        {
          passed: guard.passed,
          policy: guard.policy,
          protocolPassed: guard.protocolPassed,
          additivePassed: guard.additivePassed,
          issueCount: guard.issues.length,
          errorCount,
        },
        guard.passed ? "DEFAULT" : "WARNING",
      );
    }

    // Persist fixed content + validation info on the draft object.
    capturedDraft.proposedContent = guard.fixedProposed;
    const issues = [...guard.issues];
    let feedback = guard.feedback;
    let passed = guard.passed;
    let pptGuardFailed = false;

    if (passed && input.skillLegacyName === "doc-optimize-ppt") {
      const ppt = validatePptSlideDeck(guard.fixedProposed);
      if (!ppt.passed) {
        pptGuardFailed = true;
        passed = false;
        for (const msg of ppt.issues) {
          issues.push({
            severity: "error",
            code: "ppt_guard",
            message: msg,
          });
        }
        feedback = [feedback, ppt.feedback].filter(Boolean).join("\n\n");
      }
    }

    const validation: DraftValidation = {
      passed,
      attempt,
      policy,
      issues,
      feedback,
    };
    capturedDraft.validation = validation;

    if (validation.passed) {
      const finalSpan = input.traceContext
        ? traceManager.startSpan(input.traceContext, "doc-guard.final", {
            attempt,
            policy,
            skill: input.skillLegacyName,
          })
        : null;
      if (finalSpan) {
        traceManager.endSpan(finalSpan, { passed: true, attempt, policy }, "DEFAULT");
      }

      yield { type: "draft", draft: capturedDraft };
      if (doneMessage) {
        yield { type: "done", message: doneMessage };
      }
      return;
    }

    if (attempt < maxAttempts) {
      const retrySpan = input.traceContext
        ? traceManager.startSpan(input.traceContext, "doc-guard.retry", {
            attempt,
            nextAttempt: attempt + 1,
            policy,
            skill: input.skillLegacyName,
            passed: false,
          })
        : null;
      if (retrySpan) {
        traceManager.endSpan(retrySpan, { attempt, passed: false }, "WARNING");
      }

      input.deleteDraft(capturedDraft.id);
      const hint = pptGuardFailed ? "PPT 结构校验未通过" : "校验未通过";
      yield { type: "thinking", content: `${hint}，正在进行第 ${attempt + 1} 次修正...` };
      args = appendFeedbackToArgs(args, validation.feedback || "");
      continue;
    }

    // Final attempt failed
    const finalSpan = input.traceContext
      ? traceManager.startSpan(input.traceContext, "doc-guard.final", {
          attempt,
          policy,
          skill: input.skillLegacyName,
        })
      : null;

    if (!guard.protocolPassed) {
      input.deleteDraft(capturedDraft.id);
      if (finalSpan) {
        traceManager.endSpan(finalSpan, { passed: false, attempt, policy, reason: "protocol" }, "ERROR");
      }

      const firstError = guard.issues.find((i) => i.severity === "error")?.message || "未知协议错误";
      yield {
        type: "error",
        error: `文档协议校验失败（已尝试 ${maxAttempts} 次）：${firstError}`,
      };
      return;
    }

    // Protocol is OK but PPT slide structure is not.
    if (pptGuardFailed) {
      input.deleteDraft(capturedDraft.id);
      if (finalSpan) {
        traceManager.endSpan(finalSpan, { passed: false, attempt, policy, reason: "ppt_guard" }, "ERROR");
      }

      const first = validation.issues.find((i) => i.code === "ppt_guard")?.message || "未知结构问题";
      yield {
        type: "error",
        error: `PPT 结构校验失败（已尝试 ${maxAttempts} 次）：${first}`,
      };
      return;
    }

    if (finalSpan) {
      traceManager.endSpan(finalSpan, { passed: false, attempt, policy, reason: "additive" }, "WARNING");
    }

    // Protocol is OK but additive strict failed: return the draft for manual review/apply.
    yield { type: "draft", draft: capturedDraft };
    yield {
      type: "done",
      message: "草稿已生成，但校验发现可能删改了原文内容，请人工确认后再应用。",
    };
    return;
  }
}
