import { createHash, createVerify } from "node:crypto";

import semver from "semver";
import {
  PLUGIN_API_VERSION_V2,
  type PluginCapabilityV2,
  type PluginDocHookEventV2,
  type PluginManifestV2,
} from "@zeus/plugin-sdk-shared";

const ALLOWED_CAPABILITIES = new Set<PluginCapabilityV2>([
  "docs.read",
  "docs.write",
  "docs.hook.before",
  "docs.hook.after",
  "docs.tool.register",
  "docs.block.register",
  "system.command.register",
  "ui.menu.register",
  "ui.route.register",
  "system.service.register",
]);

const SLASH_COMMAND_REGEX = /^\/[a-z0-9][a-z0-9-]*$/;
const IDENTIFIER_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
const SETTINGS_FIELD_KEY_REGEX = /^[A-Za-z][A-Za-z0-9._-]*$/;
const DOC_HOOK_EVENTS = new Set<PluginDocHookEventV2>([
  "document.create",
  "document.update",
  "document.delete",
  "document.move",
  "document.import",
  "document.optimize",
]);

function assertCapabilityForContributions(
  manifest: PluginManifestV2,
  capability: PluginCapabilityV2,
  contributionName: string,
  count: number,
): void {
  if (count <= 0) {
    return;
  }
  if (!manifest.capabilities.includes(capability)) {
    throw new Error(
      `Plugin ${manifest.id} contributes ${contributionName} but does not declare capability ${capability}`,
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return String(value || "").trim();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter(Boolean);
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function asNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export function parsePluginManifestV2(raw: unknown): PluginManifestV2 {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid manifest: expected object");
  }

  const value = raw as Record<string, unknown>;
  const enginesRaw = asRecord(value.engines);
  const frontendRaw = asRecord(value.frontend);
  const backendRaw = asRecord(value.backend);
  const permissionsRaw = asRecord(value.permissions);
  const settingsRaw = asRecord(value.settings);
  const activationRaw = asRecord(value.activation);
  const contributesRaw = asRecord(value.contributes);

  return {
    id: asString(value.id),
    version: asString(value.version),
    displayName: asString(value.displayName),
    description: asString(value.description) || undefined,
    pluginApiVersion: Number(value.pluginApiVersion || 0) as 2,
    engines: {
      zeusAppBackend: asString(enginesRaw.zeusAppBackend) || undefined,
      zeusWeb: asString(enginesRaw.zeusWeb) || undefined,
    },
    capabilities: asStringArray(value.capabilities) as PluginCapabilityV2[],
    activation: {
      commands: asStringArray(activationRaw.commands),
      routes: asStringArray(activationRaw.routes),
      tools: asStringArray(activationRaw.tools),
      documentEvents: asStringArray(activationRaw.documentEvents) as PluginManifestV2["activation"]["documentEvents"],
    },
    contributes: {
      commands: Array.isArray(contributesRaw.commands)
        ? contributesRaw.commands
          .map((item) => {
            const row = asRecord(item);
            const id = asString(row.id);
            if (!id) return null;
            const slashAliases = asStringArray(row.slashAliases).filter((alias) => SLASH_COMMAND_REGEX.test(alias));
            return {
              id,
              title: asString(row.title) || id,
              description: asString(row.description) || id,
              category: asString(row.category) || undefined,
              inputSchema: row.inputSchema && typeof row.inputSchema === "object"
                ? row.inputSchema as Record<string, unknown>
                : undefined,
              slashAliases,
              apiEnabled: asBool(row.apiEnabled, true),
              requiresDocScope: asBool(row.requiresDocScope, false),
              handler: asString(row.handler) || undefined,
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
        : [],
      docHooks: Array.isArray(contributesRaw.docHooks)
        ? contributesRaw.docHooks
          .map((item) => {
            const row = asRecord(item);
            const id = asString(row.id);
            const stage = asString(row.stage) as "before" | "after";
            const event = asString(row.event) as PluginDocHookEventV2;
            if (!id || !stage || !event) return null;
            return {
              id,
              stage,
              event,
              priority: asNumber(row.priority),
              requiresDocScope: asBool(row.requiresDocScope, false),
              handler: asString(row.handler) || undefined,
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
        : [],
      docTools: Array.isArray(contributesRaw.docTools)
        ? contributesRaw.docTools
          .map((item) => {
            const row = asRecord(item);
            const id = asString(row.id);
            const placement = asString(row.placement) as "editorToolbar" | "documentHeader" | "contextMenu";
            const commandId = asString(row.commandId);
            if (!id || !placement || !commandId) return null;
            return {
              id,
              placement,
              commandId,
              title: asString(row.title) || id,
              order: asNumber(row.order),
              requiresDocScope: asBool(row.requiresDocScope, false),
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
        : [],
      blocks: Array.isArray(contributesRaw.blocks)
        ? contributesRaw.blocks
          .map((item) => {
            const row = asRecord(item);
            const blockType = asString(row.blockType);
            if (!blockType) return null;
            return {
              blockType,
              requiresBlockId: asBool(row.requiresBlockId, false),
              rendererEntry: asString(row.rendererEntry) || undefined,
              markdownCodec: asString(row.markdownCodec) || undefined,
              textExtractor: asString(row.textExtractor) || undefined,
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
        : [],
      menus: Array.isArray(contributesRaw.menus)
        ? contributesRaw.menus
          .map((item) => {
            const row = asRecord(item);
            const id = asString(row.id);
            const placement = asString(row.placement) as "sidebar" | "documentHeader" | "settings";
            if (!id || !placement) return null;
            return {
              id,
              placement,
              title: asString(row.title) || id,
              order: asNumber(row.order),
              icon: asString(row.icon) || undefined,
              commandId: asString(row.commandId) || undefined,
              routeId: asString(row.routeId) || undefined,
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
        : [],
      routes: Array.isArray(contributesRaw.routes)
        ? contributesRaw.routes
          .map((item) => {
            const row = asRecord(item);
            const id = asString(row.id);
            const path = asString(row.path);
            if (!id || !path) return null;
            return {
              id,
              path,
              title: asString(row.title) || undefined,
              entry: asString(row.entry) || undefined,
              order: asNumber(row.order),
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
        : [],
      services: Array.isArray(contributesRaw.services)
        ? contributesRaw.services
          .map((item) => {
            const row = asRecord(item);
            const id = asString(row.id);
            const kind = asString(row.kind) as "importer" | "exporter" | "converter" | "analyzer";
            const commandId = asString(row.commandId);
            if (!id || !kind || !commandId) return null;
            return {
              id,
              kind,
              commandId,
              title: asString(row.title) || undefined,
              description: asString(row.description) || undefined,
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
        : [],
    },
    frontend: asString(frontendRaw.entry)
      ? { entry: asString(frontendRaw.entry) }
      : undefined,
    backend: asString(backendRaw.entry)
      ? { entry: asString(backendRaw.entry) }
      : undefined,
    permissions: {
      allowedHttpHosts: asStringArray(permissionsRaw.allowedHttpHosts),
      maxExecutionMs: asNumber(permissionsRaw.maxExecutionMs),
      maxHookExecutionMs: asNumber(permissionsRaw.maxHookExecutionMs),
    },
    settings: Array.isArray(settingsRaw.fields)
      ? {
        title: asString(settingsRaw.title) || undefined,
        description: asString(settingsRaw.description) || undefined,
        fields: settingsRaw.fields
          .map((item) => {
            const row = asRecord(item);
            const key = asString(row.key);
            if (!key) return null;

            const typeRaw = asString(row.type).toLowerCase();
            const type = (typeRaw || "string") as "string" | "textarea" | "number" | "boolean" | "select";
            const options = Array.isArray(row.options)
              ? row.options
                .map((option) => {
                  const optionRow = asRecord(option);
                  const value = asString(optionRow.value);
                  if (!value) return null;
                  return {
                    value,
                    label: asString(optionRow.label) || value,
                    description: asString(optionRow.description) || undefined,
                  };
                })
                .filter((option): option is NonNullable<typeof option> => Boolean(option))
              : [];

            return {
              key,
              title: asString(row.title) || key,
              description: asString(row.description) || undefined,
              type,
              required: asBool(row.required, false),
              default: row.default as string | number | boolean | undefined,
              placeholder: asString(row.placeholder) || undefined,
              secret: asBool(row.secret, false),
              min: asNumber(row.min),
              max: asNumber(row.max),
              step: asNumber(row.step),
              options: options.length > 0 ? options : undefined,
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item)),
      }
      : undefined,
    integrity: asString(value.integrity) || undefined,
    signature: asString(value.signature) || undefined,
  };
}

export function validatePluginManifestV2(
  manifest: PluginManifestV2,
  versions: { appBackend: string; web: string },
): void {
  if (!manifest.id || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) {
    throw new Error(`Invalid plugin id: ${manifest.id || "<empty>"}`);
  }
  if (!manifest.version || !semver.valid(manifest.version)) {
    throw new Error(`Invalid plugin version: ${manifest.version || "<empty>"}`);
  }
  if (!manifest.displayName) {
    throw new Error("Invalid manifest: displayName is required");
  }
  if (manifest.pluginApiVersion !== PLUGIN_API_VERSION_V2) {
    throw new Error(`Unsupported pluginApiVersion: ${manifest.pluginApiVersion}`);
  }

  if (manifest.engines.zeusAppBackend && !semver.satisfies(versions.appBackend, manifest.engines.zeusAppBackend)) {
    throw new Error(
      `Plugin ${manifest.id}@${manifest.version} requires zeusAppBackend ${manifest.engines.zeusAppBackend}, current ${versions.appBackend}`,
    );
  }

  if (manifest.engines.zeusWeb && !semver.satisfies(versions.web, manifest.engines.zeusWeb)) {
    throw new Error(
      `Plugin ${manifest.id}@${manifest.version} requires zeusWeb ${manifest.engines.zeusWeb}, current ${versions.web}`,
    );
  }

  for (const capability of manifest.capabilities) {
    if (!ALLOWED_CAPABILITIES.has(capability)) {
      throw new Error(`Plugin ${manifest.id} uses unsupported capability: ${capability}`);
    }
  }

  const settings = manifest.settings;
  if (settings) {
    if (!Array.isArray(settings.fields) || settings.fields.length === 0) {
      throw new Error(`Plugin ${manifest.id} has invalid settings.fields`);
    }
    if (settings.fields.length > 100) {
      throw new Error(`Plugin ${manifest.id} has too many settings fields`);
    }
    const fieldKeys = new Set<string>();
    for (const field of settings.fields) {
      const fieldType = String(field.type || "").trim() as "string" | "textarea" | "number" | "boolean" | "select";
      if (!field.key || !SETTINGS_FIELD_KEY_REGEX.test(field.key)) {
        throw new Error(`Plugin ${manifest.id} has invalid settings field key: ${field.key || "<empty>"}`);
      }
      if (fieldKeys.has(field.key)) {
        throw new Error(`Plugin ${manifest.id} has duplicated settings field key: ${field.key}`);
      }
      fieldKeys.add(field.key);

      if (!["string", "textarea", "number", "boolean", "select"].includes(fieldType)) {
        throw new Error(`Plugin ${manifest.id} has invalid settings field type: ${fieldType || "<empty>"}`);
      }

      if (!field.title || !field.title.trim()) {
        throw new Error(`Plugin ${manifest.id} settings field ${field.key} requires title`);
      }

      const defaultValue = field.default;
      if (defaultValue !== undefined) {
        if ((fieldType === "string" || fieldType === "textarea" || fieldType === "select") && typeof defaultValue !== "string") {
          throw new Error(`Plugin ${manifest.id} settings field ${field.key} default must be string`);
        }
        if (fieldType === "number" && (typeof defaultValue !== "number" || !Number.isFinite(defaultValue))) {
          throw new Error(`Plugin ${manifest.id} settings field ${field.key} default must be number`);
        }
        if (fieldType === "boolean" && typeof defaultValue !== "boolean") {
          throw new Error(`Plugin ${manifest.id} settings field ${field.key} default must be boolean`);
        }
      }

      if (fieldType === "number") {
        const min = field.min;
        const max = field.max;
        const step = field.step;
        if (min !== undefined && !Number.isFinite(min)) {
          throw new Error(`Plugin ${manifest.id} settings field ${field.key} min must be number`);
        }
        if (max !== undefined && !Number.isFinite(max)) {
          throw new Error(`Plugin ${manifest.id} settings field ${field.key} max must be number`);
        }
        if (step !== undefined && (!Number.isFinite(step) || step <= 0)) {
          throw new Error(`Plugin ${manifest.id} settings field ${field.key} step must be positive number`);
        }
        if (min !== undefined && max !== undefined && min > max) {
          throw new Error(`Plugin ${manifest.id} settings field ${field.key} min cannot be greater than max`);
        }
      }

      if (fieldType === "select") {
        const options = Array.isArray(field.options) ? field.options : [];
        if (options.length === 0) {
          throw new Error(`Plugin ${manifest.id} settings field ${field.key} select requires options`);
        }
        const optionValues = new Set<string>();
        for (const option of options) {
          const optionValue = String(option.value || "").trim();
          if (!optionValue) {
            throw new Error(`Plugin ${manifest.id} settings field ${field.key} has empty option value`);
          }
          if (optionValues.has(optionValue)) {
            throw new Error(`Plugin ${manifest.id} settings field ${field.key} has duplicated option value: ${optionValue}`);
          }
          optionValues.add(optionValue);
        }
        if (typeof defaultValue === "string" && defaultValue && !optionValues.has(defaultValue)) {
          throw new Error(`Plugin ${manifest.id} settings field ${field.key} default is not in select options`);
        }
      }
    }
  }

  for (const event of manifest.activation.documentEvents || []) {
    if (!DOC_HOOK_EVENTS.has(event)) {
      throw new Error(`Plugin ${manifest.id} has invalid activation document event: ${event}`);
    }
  }

  const commands = manifest.contributes.commands || [];
  assertCapabilityForContributions(
    manifest,
    "system.command.register",
    "contributes.commands",
    commands.length,
  );
  const commandIds = new Set<string>();
  const slashAliases = new Set<string>();
  for (const command of commands) {
    if (!command.id || !IDENTIFIER_REGEX.test(command.id)) {
      throw new Error(`Plugin ${manifest.id} has invalid command id: ${command.id || "<empty>"}`);
    }
    if (commandIds.has(command.id)) {
      throw new Error(`Plugin ${manifest.id} has duplicated command id: ${command.id}`);
    }
    commandIds.add(command.id);

    for (const alias of command.slashAliases || []) {
      if (!SLASH_COMMAND_REGEX.test(alias)) {
        throw new Error(`Plugin ${manifest.id} has invalid slash alias: ${alias}`);
      }
      if (slashAliases.has(alias)) {
        throw new Error(`Plugin ${manifest.id} has duplicated slash alias: ${alias}`);
      }
      slashAliases.add(alias);
    }
  }

  const docHooks = manifest.contributes.docHooks || [];
  assertCapabilityForContributions(
    manifest,
    "docs.hook.before",
    "contributes.docHooks(stage=before)",
    docHooks.filter((hook) => hook.stage === "before").length,
  );
  assertCapabilityForContributions(
    manifest,
    "docs.hook.after",
    "contributes.docHooks(stage=after)",
    docHooks.filter((hook) => hook.stage === "after").length,
  );
  for (const hook of docHooks) {
    if (!hook.id || !IDENTIFIER_REGEX.test(hook.id)) {
      throw new Error(`Plugin ${manifest.id} has invalid hook id: ${hook.id || "<empty>"}`);
    }
    if (hook.stage !== "before" && hook.stage !== "after") {
      throw new Error(`Plugin ${manifest.id} has invalid hook stage: ${hook.stage}`);
    }
    if (!hook.event) {
      throw new Error(`Plugin ${manifest.id} has invalid hook event`);
    }
    if (!DOC_HOOK_EVENTS.has(hook.event)) {
      throw new Error(`Plugin ${manifest.id} has invalid hook event: ${hook.event}`);
    }
  }

  const docTools = manifest.contributes.docTools || [];
  assertCapabilityForContributions(
    manifest,
    "docs.tool.register",
    "contributes.docTools",
    docTools.length,
  );
  for (const tool of docTools) {
    if (!tool.id || !IDENTIFIER_REGEX.test(tool.id)) {
      throw new Error(`Plugin ${manifest.id} has invalid doc tool id: ${tool.id || "<empty>"}`);
    }
    if (!tool.commandId || !IDENTIFIER_REGEX.test(tool.commandId)) {
      throw new Error(`Plugin ${manifest.id} has invalid doc tool commandId: ${tool.commandId || "<empty>"}`);
    }
  }

  const blocks = manifest.contributes.blocks || [];
  assertCapabilityForContributions(
    manifest,
    "docs.block.register",
    "contributes.blocks",
    blocks.length,
  );
  if (blocks.length > 0 && !manifest.frontend?.entry) {
    throw new Error(`Plugin ${manifest.id} contributes blocks but frontend.entry is missing`);
  }
  for (const block of blocks) {
    if (!block.blockType || !IDENTIFIER_REGEX.test(block.blockType)) {
      throw new Error(`Plugin ${manifest.id} has invalid block type: ${block.blockType || "<empty>"}`);
    }
  }

  const menus = manifest.contributes.menus || [];
  assertCapabilityForContributions(
    manifest,
    "ui.menu.register",
    "contributes.menus",
    menus.length,
  );
  for (const menu of menus) {
    if (!menu.id || !IDENTIFIER_REGEX.test(menu.id)) {
      throw new Error(`Plugin ${manifest.id} has invalid menu id: ${menu.id || "<empty>"}`);
    }
  }

  const routes = manifest.contributes.routes || [];
  assertCapabilityForContributions(
    manifest,
    "ui.route.register",
    "contributes.routes",
    routes.length,
  );
  for (const route of routes) {
    if (!route.id || !IDENTIFIER_REGEX.test(route.id)) {
      throw new Error(`Plugin ${manifest.id} has invalid route id: ${route.id || "<empty>"}`);
    }
    if (!route.path || !route.path.startsWith("/")) {
      throw new Error(`Plugin ${manifest.id} has invalid route path: ${route.path || "<empty>"}`);
    }
  }

  const services = manifest.contributes.services || [];
  assertCapabilityForContributions(
    manifest,
    "system.service.register",
    "contributes.services",
    services.length,
  );
  for (const service of services) {
    if (!service.id || !IDENTIFIER_REGEX.test(service.id)) {
      throw new Error(`Plugin ${manifest.id} has invalid service id: ${service.id || "<empty>"}`);
    }
    if (!service.commandId || !IDENTIFIER_REGEX.test(service.commandId)) {
      throw new Error(`Plugin ${manifest.id} has invalid service commandId: ${service.commandId || "<empty>"}`);
    }
  }

  const requiresBackendEntry = commands.length > 0 || docHooks.length > 0 || services.length > 0;
  if (requiresBackendEntry && !manifest.backend?.entry) {
    throw new Error(`Plugin ${manifest.id} contributes backend handlers but backend.entry is missing`);
  }

  const maxExecutionMs = Number(manifest.permissions?.maxExecutionMs || 0);
  const maxHookExecutionMs = Number(manifest.permissions?.maxHookExecutionMs || 0);
  if (maxExecutionMs < 0 || !Number.isFinite(maxExecutionMs)) {
    throw new Error(`Plugin ${manifest.id} has invalid permissions.maxExecutionMs`);
  }
  if (maxHookExecutionMs < 0 || !Number.isFinite(maxHookExecutionMs)) {
    throw new Error(`Plugin ${manifest.id} has invalid permissions.maxHookExecutionMs`);
  }
}

export function assertManifestIntegrityV2(
  manifest: PluginManifestV2,
  packageBuffer: Buffer,
): string {
  const digest = createHash("sha256").update(packageBuffer).digest("hex");
  if (manifest.integrity) {
    const normalized = manifest.integrity.replace(/^sha256:/i, "").trim().toLowerCase();
    if (normalized !== digest.toLowerCase()) {
      throw new Error(`Integrity verification failed for ${manifest.id}@${manifest.version}`);
    }
  }
  return digest;
}

export function verifyManifestSignatureV2(
  manifest: PluginManifestV2,
  digestHex: string,
  publicKeyPem: string,
  requireSignature: boolean,
): void {
  if (!manifest.signature) {
    if (requireSignature) {
      throw new Error(`Signature is required for ${manifest.id}@${manifest.version}`);
    }
    return;
  }

  if (!publicKeyPem) {
    throw new Error("Plugin signature public key is not configured");
  }

  const verifier = createVerify("sha256");
  verifier.update(`${manifest.id}\n${manifest.version}\n${digestHex}`);
  verifier.end();

  const ok = verifier.verify(publicKeyPem, Buffer.from(manifest.signature, "base64"));
  if (!ok) {
    throw new Error(`Signature verification failed for ${manifest.id}@${manifest.version}`);
  }
}
