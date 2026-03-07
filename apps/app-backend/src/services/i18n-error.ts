import type { Request, Response } from "express";

import { DEFAULT_LOCALE } from "../i18n/locale.js";
import { translateAppMessage, translateAppMessageSync } from "../i18n/runtime.js";

export function buildLocalizedErrorPayloadSync(input: {
  locale?: string | null;
  code: string;
  fallbackMessage: string;
  params?: Record<string, unknown>;
}): { code: string; message: string; locale: string } {
  const { locale, message } = translateAppMessageSync({
    locale: input.locale || DEFAULT_LOCALE,
    key: input.code,
    namespace: "errors",
    fallback: input.fallbackMessage,
    params: input.params,
  });
  return {
    code: input.code,
    message,
    locale,
  };
}

export async function buildLocalizedErrorPayload(input: {
  locale?: string | null;
  code: string;
  fallbackMessage: string;
  params?: Record<string, unknown>;
}): Promise<{ code: string; message: string; locale: string }> {
  const { locale, message } = await translateAppMessage({
    locale: input.locale || DEFAULT_LOCALE,
    key: input.code,
    namespace: "errors",
    fallback: input.fallbackMessage,
    params: input.params,
  });
  return {
    code: input.code,
    message,
    locale,
  };
}

export async function localizedError(
  res: Response,
  req: Request,
  code: string,
  fallbackMessage: string,
  status = 400,
  params?: Record<string, unknown>,
): Promise<void> {
  const payload = await buildLocalizedErrorPayload({
    locale: req.locale,
    code,
    fallbackMessage,
    params,
  });
  res.status(status).json(payload);
}
