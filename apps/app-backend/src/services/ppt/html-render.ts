export type PptHtmlSlideModel = {
  title: string;
  subtitle?: string;
  goal?: string;
  bullets?: string[];
  visualHint?: string;
  layoutHint?: string;
  speakerNotes?: string;
};

export type PptHtmlModel = {
  deckTitle: string;
  subtitle?: string;
  presenter?: string;
  reportTime?: string;
  slides: PptHtmlSlideModel[];
};

type RenderTheme = "modern" | "business" | "minimal" | "dark";

const MAX_SLIDES = 40;
const MAX_BULLETS_PER_SLIDE = 8;

function toSafeString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function toSafeStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, maxItems);
}

export function normalizePptHtmlModel(raw: unknown): PptHtmlModel {
  const obj = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const rawSlides = Array.isArray(obj.slides) ? obj.slides : [];

  const slides: PptHtmlSlideModel[] = rawSlides
    .map((slide, index) => {
      const row = slide && typeof slide === "object" ? slide as Record<string, unknown> : {};
      const bullets = toSafeStringArray(row.bullets, MAX_BULLETS_PER_SLIDE);
      const subtitle = toSafeString(row.subtitle);
      const goal = toSafeString(row.goal);
      const visualHint = toSafeString(row.visualHint);
      const layoutHint = toSafeString(row.layoutHint);
      const speakerNotes = toSafeString(row.speakerNotes);

      return {
        title: toSafeString(row.title, `幻灯片 ${index + 1}`),
        ...(subtitle ? { subtitle } : {}),
        ...(goal ? { goal } : {}),
        ...(bullets.length > 0 ? { bullets } : {}),
        ...(visualHint ? { visualHint } : {}),
        ...(layoutHint ? { layoutHint } : {}),
        ...(speakerNotes ? { speakerNotes } : {}),
      };
    })
    .slice(0, MAX_SLIDES);

  if (slides.length === 0) {
    slides.push({
      title: "幻灯片 1：内容待补充",
      bullets: ["请根据文档内容补充关键要点"],
      speakerNotes: "自动兜底页",
    });
  }

  return {
    deckTitle: toSafeString(obj.deckTitle, "演示稿"),
    subtitle: toSafeString(obj.subtitle),
    presenter: toSafeString(obj.presenter, "待填写"),
    reportTime: toSafeString(obj.reportTime, new Date().toISOString().slice(0, 10)),
    slides,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function themeTokens(theme: RenderTheme): {
  bg: string;
  card: string;
  title: string;
  text: string;
  subtle: string;
  accent: string;
} {
  switch (theme) {
    case "business":
      return {
        bg: "#f3f6fb",
        card: "#ffffff",
        title: "#0b1f3a",
        text: "#1f2f46",
        subtle: "#5a6b85",
        accent: "#2255dd",
      };
    case "minimal":
      return {
        bg: "#fafafa",
        card: "#ffffff",
        title: "#111827",
        text: "#1f2937",
        subtle: "#6b7280",
        accent: "#4f46e5",
      };
    case "dark":
      return {
        bg: "#0b1020",
        card: "#141b2d",
        title: "#f9fafb",
        text: "#d1d5db",
        subtle: "#9ca3af",
        accent: "#60a5fa",
      };
    case "modern":
    default:
      return {
        bg: "#eef4ff",
        card: "#ffffff",
        title: "#0f172a",
        text: "#1e293b",
        subtle: "#64748b",
        accent: "#2563eb",
      };
  }
}

export function renderPptHtmlFromModel(
  model: PptHtmlModel,
  options?: { theme?: string },
): string {
  const normalized = normalizePptHtmlModel(model);
  const theme = (options?.theme || "modern") as RenderTheme;
  const t = themeTokens(theme);

  const slidesHtml = normalized.slides
    .map((slide, index) => {
      const bullets = (slide.bullets || [])
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("");

      return `
<section class="slide" data-slide-index="${index + 1}">
  <header class="slide-header">
    <div class="slide-index">${index + 1}</div>
    <h2>${escapeHtml(slide.title)}</h2>
    ${slide.subtitle ? `<p class="slide-subtitle">${escapeHtml(slide.subtitle)}</p>` : ""}
  </header>
  ${slide.goal ? `<p class="slide-goal"><strong>页面目标：</strong>${escapeHtml(slide.goal)}</p>` : ""}
  ${bullets ? `<ul class="slide-bullets">${bullets}</ul>` : ""}
  ${(slide.visualHint || slide.layoutHint)
    ? `<div class="slide-hints">${slide.visualHint ? `<p><strong>视觉建议：</strong>${escapeHtml(slide.visualHint)}</p>` : ""}${slide.layoutHint ? `<p><strong>版式建议：</strong>${escapeHtml(slide.layoutHint)}</p>` : ""}</div>`
    : ""}
  ${slide.speakerNotes ? `<aside class="slide-notes"><strong>讲解备注：</strong>${escapeHtml(slide.speakerNotes)}</aside>` : ""}
</section>`.trim();
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(normalized.deckTitle)}</title>
  <style>
    :root {
      --bg: ${t.bg};
      --card: ${t.card};
      --title: ${t.title};
      --text: ${t.text};
      --subtle: ${t.subtle};
      --accent: ${t.accent};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px;
      font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }
    .deck-meta {
      margin-bottom: 16px;
      padding: 16px;
      border-radius: 12px;
      background: var(--card);
      border: 1px solid rgba(0,0,0,0.06);
    }
    .deck-meta h1 {
      margin: 0 0 8px;
      color: var(--title);
      font-size: 28px;
    }
    .deck-meta .subtitle {
      margin: 0 0 10px;
      color: var(--subtle);
    }
    .deck-meta .meta-line {
      margin: 0;
      font-size: 14px;
      color: var(--subtle);
    }
    .deck {
      display: grid;
      gap: 14px;
    }
    .slide {
      background: var(--card);
      border: 1px solid rgba(0,0,0,0.08);
      border-left: 6px solid var(--accent);
      border-radius: 12px;
      padding: 18px;
    }
    .slide-header {
      margin-bottom: 8px;
    }
    .slide-index {
      font-size: 12px;
      color: var(--subtle);
      margin-bottom: 4px;
    }
    .slide-header h2 {
      margin: 0;
      font-size: 22px;
      color: var(--title);
    }
    .slide-subtitle {
      margin: 6px 0 0;
      color: var(--subtle);
      font-size: 14px;
    }
    .slide-goal {
      margin: 10px 0;
    }
    .slide-bullets {
      margin: 10px 0;
      padding-left: 18px;
    }
    .slide-bullets li {
      margin: 6px 0;
    }
    .slide-hints {
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: rgba(37,99,235,0.08);
      font-size: 14px;
    }
    .slide-hints p {
      margin: 4px 0;
    }
    .slide-notes {
      margin-top: 12px;
      font-size: 13px;
      color: var(--subtle);
      border-top: 1px dashed rgba(0,0,0,0.18);
      padding-top: 8px;
    }
  </style>
</head>
<body>
  <section class="deck-meta">
    <h1>${escapeHtml(normalized.deckTitle)}</h1>
    ${normalized.subtitle ? `<p class="subtitle">${escapeHtml(normalized.subtitle)}</p>` : ""}
    <p class="meta-line">报告人：${escapeHtml(normalized.presenter || "待填写")}｜报告时间：${escapeHtml(normalized.reportTime || "待填写")}</p>
  </section>
  <main class="deck">${slidesHtml}</main>
</body>
</html>`;
}

export function sanitizePptHtml(html: string): string {
  let sanitized = html || "";

  sanitized = sanitized
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/\s(href|src)\s*=\s*(["'])\s*(javascript:|vbscript:|data:text\/html)[^"']*\2/gi, "")
    .replace(/\u0000/g, "");

  return sanitized.trim();
}
