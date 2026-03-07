import { getOptimizeCapability } from "./capabilities.js";
import {
  OPTIMIZE_STYLE_VALUES,
  type OptimizeCapabilityId,
  type OptimizeStyle,
} from "./types.js";

const STYLE_ALIASES: Record<string, OptimizeStyle> = {
  professional: "professional",
  专业: "professional",
  concise: "concise",
  精简: "concise",
  简洁: "concise",
  friendly: "friendly",
  友好: "friendly",
  亲和: "friendly",
  academic: "academic",
  学术: "academic",
  technical: "technical",
  技术: "technical",
  marketing: "marketing",
  营销: "marketing",
  宣发: "marketing",
};

function normalizeStyle(style?: string): OptimizeStyle {
  if (!style) return "professional";
  const normalized = style.trim().toLowerCase();
  return STYLE_ALIASES[normalized] || "professional";
}

export function buildOptimizePrompt(input: {
  capabilityId: OptimizeCapabilityId;
  markdown: string;
  instructions?: string;
  style?: string;
}): {
  systemPrompt: string;
  userPrompt: string;
  style: OptimizeStyle;
  temperature: number;
} {
  const capability = getOptimizeCapability(input.capabilityId);
  const style = normalizeStyle(input.style);
  const extra = input.instructions?.trim();

  const styleRule = input.capabilityId === "doc-optimize-style"
    ? `目标风格: ${style}`
    : "";

  const preserveRule = capability.preserveStructure
    ? "- 尽量保持原有章节结构和段落顺序。\n"
    : "";

  const extraRule = extra
    ? `- 额外要求：${extra}\n`
    : "";

  const modeRule = (() => {
    switch (capability.mode) {
      case "format":
        return "- 只优化格式，不改写事实内容。";
      case "content":
        return "- 优化表达与逻辑，避免新增未提供的事实。";
      case "style":
        return "- 在保持事实正确和信息完整的前提下，按目标风格改写。";
      case "full":
      default:
        return "- 同时优化格式与内容，优先保证可读性和信息准确。";
    }
  })();

  const systemPrompt = `你是 Zeus 的文档优化 Agent。

请输出纯 Markdown，不要输出解释性文字。

规则:
${modeRule}
${preserveRule}${extraRule}${styleRule ? `- ${styleRule}\n` : ""}- 代码块请保留语言标记。
- 不要使用代码围栏包裹整篇输出。`;

  const styleHint = input.capabilityId === "doc-optimize-style"
    ? `\n\n风格参考: ${style}。\n可用风格: ${OPTIMIZE_STYLE_VALUES.join(", ")}。`
    : "";

  const userPrompt = `请优化以下 Markdown 文档：\n\n\`\`\`markdown\n${input.markdown}\n\`\`\`${styleHint}${
    extra ? `\n\n额外要求：${extra}` : ""
  }`;

  return {
    systemPrompt,
    userPrompt,
    style,
    temperature: capability.temperature,
  };
}
