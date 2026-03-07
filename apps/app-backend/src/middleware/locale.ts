import type { NextFunction, Request, Response } from "express";

import { DEFAULT_LOCALE, resolveLocaleFromHeaders } from "../i18n/locale.js";
import { runWithRequestLocale } from "../i18n/request-context.js";

declare global {
  namespace Express {
    interface Request {
      locale?: string;
    }
  }
}

export function localeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.locale = resolveLocaleFromHeaders(req.headers as Record<string, unknown>) || DEFAULT_LOCALE;
  runWithRequestLocale(req.locale, next);
}
