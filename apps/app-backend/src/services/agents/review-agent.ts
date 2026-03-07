import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import net from "node:net";
import { traceManager, type TraceContext } from "../../observability/index.js";

export type ReviewAgentPlan =
  | { action: "respond_text"; text: string }
  | { action: "respond_blocked"; reason: string }
  | { action: "respond_error"; error: string };

export type ReviewAgentInput = {
  matchedSkillId: string | null;
  skillArgs: Record<string, unknown>;
  needsConfirmation: boolean;
  /**
   * Current plan action from the Supervisor (optional).
   * When absent we assume the flow is heading to confirmation (or awaiting a plan).
   */
  planAction?: string;
  traceContext?: TraceContext;
};

export type ReviewAgentOutput = {
  matchedSkillId: string | null;
  needsConfirmation: boolean;
  plan: ReviewAgentPlan | null;
  reviewWarningMessage?: string;
};

/** Helper: last-value reducer with a default. Required by @langchain/langgraph ^0.2 */
function lv<T>(defaultFn: () => T) {
  return { value: (_prev: T, next: T) => next, default: defaultFn };
}

const ReviewGraphState = Annotation.Root({
  matchedSkillId: Annotation<string | null>(lv<string | null>(() => null)),
  skillArgs: Annotation<Record<string, unknown>>(lv<Record<string, unknown>>(() => ({}))),
  needsConfirmation: Annotation<boolean>(lv<boolean>(() => false)),
  planAction: Annotation<string | undefined>(lv<string | undefined>(() => undefined)),

  plan: Annotation<ReviewAgentPlan | null>(lv<ReviewAgentPlan | null>(() => null)),
  reviewWarningMessage: Annotation<string | undefined>(lv<string | undefined>(() => undefined)),
});

type ReviewState = typeof ReviewGraphState.State;

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map((x) => Number.parseInt(x, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return false;

  const [a, b] = parts;

  // 10.0.0.0/8
  if (a === 10) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 0.0.0.0/8
  if (a === 0) return true;
  // 100.64.0.0/10 (CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1") return true; // loopback
  if (h.startsWith("fe80:")) return true; // link-local
  // fc00::/7 unique local (fc00..fdff)
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

function classifyUrlRisk(url: URL): { ok: true } | { ok: false; message: string } | { ok: true; warning: string } {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: "仅支持 http/https URL。" };
  }

  const host = url.hostname;
  if (!host) {
    return { ok: false, message: "URL 缺少 hostname，请提供完整地址（例如 https://example.com）。" };
  }

  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) {
    return { ok: true, warning: "目标地址为 localhost，可能是内网/本机地址。请确认这是预期行为。" };
  }

  const ipKind = net.isIP(host);
  if (ipKind === 4 && isPrivateIpv4(host)) {
    return { ok: true, warning: `目标地址为内网 IP (${host})，请确认这是预期行为。` };
  }
  if (ipKind === 6 && isPrivateIpv6(host)) {
    return { ok: true, warning: `目标地址为内网 IPv6 (${host})，请确认这是预期行为。` };
  }

  return { ok: true };
}

function getStringArg(args: Record<string, unknown>, key: string): string {
  const raw = args[key];
  return typeof raw === "string" ? raw.trim() : "";
}

async function review(state: ReviewState): Promise<Partial<ReviewState>> {
  // No resolved skill (or we're already in pure chat flow).
  if (!state.matchedSkillId) {
    return { plan: null, reviewWarningMessage: undefined };
  }

  // If supervisor already decided a terminal response, don't interfere.
  if (state.planAction && ["respond_text", "respond_blocked", "respond_error", "respond_rejected"].includes(state.planAction)) {
    return { plan: null, reviewWarningMessage: undefined };
  }

  // Heuristic: validate URL-like args early and gate private/loopback targets.
  const url = getStringArg(state.skillArgs, "url");
  const repoUrl = getStringArg(state.skillArgs, "repo_url");
  const candidates = [
    { key: "url", value: url, label: "URL" },
    { key: "repo_url", value: repoUrl, label: "Git 仓库 URL" },
  ].filter((c) => c.value);

  for (const c of candidates) {
    // Require explicit scheme to avoid ambiguity.
    if (!/^https?:\/\//i.test(c.value)) {
      return {
        matchedSkillId: null,
        needsConfirmation: false,
        plan: { action: "respond_text", text: `${c.label} 需要以 http:// 或 https:// 开头。` },
        reviewWarningMessage: undefined,
      };
    }

    let parsed: URL;
    try {
      parsed = new URL(c.value);
    } catch {
      return {
        matchedSkillId: null,
        needsConfirmation: false,
        plan: { action: "respond_text", text: `${c.label} 格式不正确，请提供完整可解析的地址。` },
        reviewWarningMessage: undefined,
      };
    }

    const risk = classifyUrlRisk(parsed);
    if (!risk.ok) {
      return {
        matchedSkillId: null,
        needsConfirmation: false,
        plan: { action: "respond_text", text: risk.message },
        reviewWarningMessage: undefined,
      };
    }

    if ("warning" in risk && risk.warning) {
      return {
        // Force confirmation for potentially sensitive targets.
        needsConfirmation: true,
        plan: null,
        reviewWarningMessage: risk.warning,
      };
    }
  }

  return {
    plan: null,
    reviewWarningMessage: undefined,
  };
}

export const reviewAgentGraph = new StateGraph(ReviewGraphState)
  .addNode("review", review)
  .addEdge(START, "review")
  .addEdge("review", END)
  .compile({ checkpointer: false, name: "review_agent" });

export async function runReviewAgent(input: ReviewAgentInput): Promise<ReviewAgentOutput> {
  const span = input.traceContext
    ? traceManager.startSpan(input.traceContext, "agent.review", {
        matchedSkillId: input.matchedSkillId,
        needsConfirmation: input.needsConfirmation,
        planAction: input.planAction,
      })
    : null;
  const start = Date.now();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangGraph invoke typing requires exact match
    const result = await reviewAgentGraph.invoke({
      matchedSkillId: input.matchedSkillId,
      skillArgs: input.skillArgs,
      needsConfirmation: input.needsConfirmation,
      planAction: input.planAction,
    } as any);

    const matchedSkillId = typeof result.matchedSkillId === "string" ? result.matchedSkillId : null;
    const needsConfirmation = Boolean(result.needsConfirmation);
    const plan = (result.plan && typeof result.plan === "object")
      ? (result.plan as ReviewAgentPlan)
      : null;

    const reviewWarningMessage = typeof result.reviewWarningMessage === "string" && result.reviewWarningMessage.trim()
      ? result.reviewWarningMessage.trim()
      : undefined;

    if (span) {
      traceManager.endSpan(span, {
        matchedSkillId,
        needsConfirmation,
        planAction: plan?.action,
        reviewWarning: Boolean(reviewWarningMessage),
        durationMs: Date.now() - start,
      });
    }

    return {
      matchedSkillId,
      needsConfirmation,
      plan,
      ...(reviewWarningMessage ? { reviewWarningMessage } : {}),
    };
  } catch (err) {
    if (span) {
      traceManager.endSpan(span, {
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      }, "ERROR");
    }
    throw err;
  }
}
