declare module "@mozilla/readability" {
  export class Readability {
    constructor(document: Document);
    parse(): { title?: string; content?: string } | null;
  }
}

declare module "turndown" {
  export default class TurndownService {
    constructor(options?: {
      headingStyle?: "setext" | "atx";
      codeBlockStyle?: "indented" | "fenced";
    });
    turndown(input: string): string;
  }
}
