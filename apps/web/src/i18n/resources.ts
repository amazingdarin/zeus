import commonZhCN from "../../../../locales/generated/web/zh-CN/common.json";
import authZhCN from "../../../../locales/generated/web/zh-CN/auth.json";
import chatZhCN from "../../../../locales/generated/web/zh-CN/chat.json";
import documentZhCN from "../../../../locales/generated/web/zh-CN/document.json";
import eduZhCN from "../../../../locales/generated/web/zh-CN/edu.json";
import settingsZhCN from "../../../../locales/generated/web/zh-CN/settings.json";
import teamZhCN from "../../../../locales/generated/web/zh-CN/team.json";
import errorsZhCN from "../../../../locales/generated/web/zh-CN/errors.json";

import commonEn from "../../../../locales/generated/web/en/common.json";
import authEn from "../../../../locales/generated/web/en/auth.json";
import chatEn from "../../../../locales/generated/web/en/chat.json";
import documentEn from "../../../../locales/generated/web/en/document.json";
import eduEn from "../../../../locales/generated/web/en/edu.json";
import settingsEn from "../../../../locales/generated/web/en/settings.json";
import teamEn from "../../../../locales/generated/web/en/team.json";
import errorsEn from "../../../../locales/generated/web/en/errors.json";

export const WEB_I18N_NAMESPACES = ["common", "auth", "chat", "document", "edu", "settings", "team", "errors"] as const;

export const webI18nResources = {
  "zh-CN": {
    common: commonZhCN,
    auth: authZhCN,
    chat: chatZhCN,
    document: documentZhCN,
    edu: eduZhCN,
    settings: settingsZhCN,
    team: teamZhCN,
    errors: errorsZhCN,
  },
  en: {
    common: commonEn,
    auth: authEn,
    chat: chatEn,
    document: documentEn,
    edu: eduEn,
    settings: settingsEn,
    team: teamEn,
    errors: errorsEn,
  },
} as const;
