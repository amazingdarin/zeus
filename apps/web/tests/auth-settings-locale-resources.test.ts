import assert from "node:assert/strict";
import { test } from "node:test";

import authZh from "../../../locales/generated/web/zh-CN/auth.json";
import authEn from "../../../locales/generated/web/en/auth.json";
import settingsZh from "../../../locales/generated/web/zh-CN/settings.json";
import settingsEn from "../../../locales/generated/web/en/settings.json";
import commonZh from "../../../locales/generated/web/zh-CN/common.json";
import commonEn from "../../../locales/generated/web/en/common.json";
import chatZh from "../../../locales/generated/web/zh-CN/chat.json";
import chatEn from "../../../locales/generated/web/en/chat.json";
import documentZh from "../../../locales/generated/web/zh-CN/document.json";
import documentEn from "../../../locales/generated/web/en/document.json";
import eduZh from "../../../locales/generated/web/zh-CN/edu.json";
import eduEn from "../../../locales/generated/web/en/edu.json";
import teamZh from "../../../locales/generated/web/zh-CN/team.json";
import teamEn from "../../../locales/generated/web/en/team.json";

const requiredAuthKeys = [
  "auth.login.heading",
  "auth.login.subtitle",
  "auth.login.success",
  "auth.register.heading",
  "auth.register.passwordMismatch",
];

const requiredCommonKeys = [
  "shell.nav.aiAssistant",
  "shell.menu.settings",
  "shell.guest.title",
  "shell.messages.logoutSuccess",
];

const requiredChatKeys = [
  "chat.empty.title",
  "chat.sidebar.showHistory",
  "chat.deepSearch.enable",
];

const requiredTeamKeys = [
  "team.list.title",
  "team.settings.updated",
  "project.selector.choose",
];

const requiredEduKeys = [
  "edu.title.default",
  "edu.save.success",
  "edu.search.placeholder",
];

const requiredDocumentKeys = [
  "document.tree.show",
  "document.diff.title",
  "document.systemDocs.title",
];

const requiredSettingsKeys = [
  "settings.general.authRequired",
  "settings.general.loading",
  "settings.remoteKnowledge.title",
  "settings.trash.title",
  "settings.shortcuts.title",
  "settings.shortcuts.blocks.paragraph",
  "settings.actions.save",
  "settings.aiProviders.title",
  "settings.pluginMarket.title",
  "settings.webSearch.title",
  "settings.modal.title",
  "settings.appearance.title",
];

test("auth/settings locale resources: required auth keys exist in zh-CN and en", () => {
  for (const key of requiredAuthKeys) {
    assert.ok(key in authZh, `missing zh auth key ${key}`);
    assert.ok(key in authEn, `missing en auth key ${key}`);
  }
});

test("auth/settings locale resources: required settings keys exist in zh-CN and en", () => {
  for (const key of requiredSettingsKeys) {
    assert.ok(key in settingsZh, `missing zh settings key ${key}`);
    assert.ok(key in settingsEn, `missing en settings key ${key}`);
  }
});


test("auth/settings locale resources: required common shell keys exist in zh-CN and en", () => {
  for (const key of requiredCommonKeys) {
    assert.ok(key in commonZh, `missing zh common key ${key}`);
    assert.ok(key in commonEn, `missing en common key ${key}`);
  }
});


test("auth/settings locale resources: required chat keys exist in zh-CN and en", () => {
  for (const key of requiredChatKeys) {
    assert.ok(key in chatZh, `missing zh chat key ${key}`);
    assert.ok(key in chatEn, `missing en chat key ${key}`);
  }
});

test("auth/settings locale resources: required document page keys exist in zh-CN and en", () => {
  for (const key of requiredDocumentKeys) {
    assert.ok(key in documentZh, `missing zh document key ${key}`);
    assert.ok(key in documentEn, `missing en document key ${key}`);
  }
});


test("auth/settings locale resources: required edu keys exist in zh-CN and en", () => {
  for (const key of requiredEduKeys) {
    assert.ok(key in eduZh, `missing zh edu key ${key}`);
    assert.ok(key in eduEn, `missing en edu key ${key}`);
  }
});


test("auth/settings locale resources: required team keys exist in zh-CN and en", () => {
  for (const key of requiredTeamKeys) {
    assert.ok(key in teamZh, `missing zh team key ${key}`);
    assert.ok(key in teamEn, `missing en team key ${key}`);
  }
});
