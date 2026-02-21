import { JSDOM } from "jsdom";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type AspectRatio = "16:9" | "4:3";

type HtmlExportOptions = {
  aspectRatio?: AspectRatio;
};

type ViewportConfig = {
  width: number;
  height: number;
  layout: "LAYOUT_WIDE" | "LAYOUT_4x3";
  pptxWidth: number;
  pptxHeight: number;
};

const VIEWPORTS: Record<AspectRatio, ViewportConfig> = {
  "16:9": {
    width: 1920,
    height: 1080,
    layout: "LAYOUT_WIDE",
    pptxWidth: 13.333,
    pptxHeight: 7.5,
  },
  "4:3": {
    width: 1440,
    height: 1080,
    layout: "LAYOUT_4x3",
    pptxWidth: 10,
    pptxHeight: 7.5,
  },
};

const EXPORT_CSS = `
<style>
  html, body { width: 100%; height: 100%; }
  body { margin: 0; }
  .deck { display: block; width: 100%; height: 100%; }
  .slide { width: 100%; height: 100%; }
</style>`;

function buildSlideHtml(headHtml: string, slideHtml: string, lang: string | null): string {
  const language = lang || "zh-CN";
  return `<!doctype html>
<html lang="${language}">
<head>
${headHtml}
${EXPORT_CSS}
</head>
<body>
${slideHtml}
</body>
</html>`;
}

function splitDeckHtml(html: string): string[] {
  const dom = new JSDOM(html);
  const { document } = dom.window;
  const headHtml = document.head?.innerHTML || "";
  const lang = document.documentElement?.getAttribute("lang");
  const slides = Array.from(document.querySelectorAll("section.slide"));

  if (slides.length === 0) {
    return [html];
  }

  return slides.map((slide) => buildSlideHtml(headHtml, slide.outerHTML, lang));
}

async function writePptxToBuffer(pptx: any): Promise<Buffer> {
  const tmpPath = path.join(
    os.tmpdir(),
    `pptx-${Date.now()}-${Math.random().toString(16).slice(2)}.pptx`,
  );

  try {
    await pptx.writeFile({ fileName: tmpPath });
  } catch (err) {
    await pptx.writeFile(tmpPath);
  }

  const buffer = await fs.readFile(tmpPath);
  await fs.unlink(tmpPath);
  return buffer;
}

export async function exportHtmlToPptxBuffer(
  html: string,
  options?: HtmlExportOptions,
): Promise<Buffer> {
  const aspectRatio: AspectRatio = options?.aspectRatio === "4:3" ? "4:3" : "16:9";
  const viewport = VIEWPORTS[aspectRatio];
  const slides = splitDeckHtml(html);

  if (slides.length === 0) {
    throw new Error("No slides found in HTML");
  }

  const [{ chromium }, pptxModule] = await Promise.all([
    import("playwright"),
    import("pptxgenjs"),
  ]);
  const PptxGenJS = (pptxModule as any).default || pptxModule;
  const pptx = new PptxGenJS();
  pptx.layout = viewport.layout;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
  });

  try {
    for (const slideHtml of slides) {
      await page.setContent(slideHtml, { waitUntil: "networkidle" });
      await page.waitForTimeout(50);

      const pngBuffer = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
      });

      const slide = pptx.addSlide();
      slide.addImage({
        data: `data:image/png;base64,${pngBuffer.toString("base64")}`,
        x: 0,
        y: 0,
        w: viewport.pptxWidth,
        h: viewport.pptxHeight,
      });
    }
  } finally {
    await page.close();
    await browser.close();
  }

  return writePptxToBuffer(pptx);
}
