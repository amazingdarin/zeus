import mammoth from "mammoth";
import pdf from "pdf-parse";
import TurndownService from "turndown";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

export type ConvertResult = {
  content: string;
  output_type?: string;
};

export const convertDocument = async (
  _projectKey: string,
  file: Express.Multer.File,
  from: string,
  to: string,
): Promise<ConvertResult> => {
  const source = from.trim().toLowerCase();
  const target = to.trim().toLowerCase();
  if (!source || !target) {
    throw new Error("from/to is required");
  }
  if (target !== "markdown") {
    throw new Error("only markdown output is supported");
  }
  if (!file || !file.buffer?.length) {
    throw new Error("empty file");
  }

  if (source === "docx") {
    const result = await mammoth.convertToMarkdown({ buffer: file.buffer });
    return { content: result.value || "", output_type: "markdown" };
  }

  if (source === "pdf") {
    const parsed = await pdf(file.buffer);
    return { content: parsed.text || "", output_type: "markdown" };
  }

  if (source === "html") {
    const html = file.buffer.toString("utf-8");
    const dom = new JSDOM(html);
    const article = new Readability(dom.window.document).parse();
    const content = article?.content ?? html;
    const markdown = turndown.turndown(content);
    return { content: markdown, output_type: "markdown" };
  }

  if (source === "md" || source === "markdown" || source === "txt") {
    return { content: file.buffer.toString("utf-8"), output_type: "markdown" };
  }

  throw new Error("unsupported conversion type");
};
