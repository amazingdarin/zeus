import { createHash, createVerify } from "node:crypto";

import semver from "semver";
import {
  PLUGIN_API_VERSION,
  type PluginCapability,
  type PluginCommandDescriptor,
  type PluginManifest,
  type PluginRiskLevel,
} from "@zeus/plugin-sdk-shared";

const ALLOWED_CAPABILITIES = new Set<PluginCapability>([
  "editor.block.register",
  "doc.operation.execute",
  "menu.module.mount",
  "route.module.mount",
]);

const COMMAND_REGEX = /^\/[a-z0-9][a-z0-9-]*$/;

export function parsePluginManifest(raw: unknown): PluginManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid manifest: expected object");
  }
  const value = raw as Record<string, unknown>;
  const id = String(value.id || "").trim();
  const version = String(value.version || "").trim();
  const displayName = String(value.displayName || "").trim();
  const pluginApiVersion = Number(value.pluginApiVersion || 0);
  const enginesRaw = value.engines && typeof value.engines === "object"
    ? (value.engines as Record<string, unknown>)
    : {};
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.map((item) => String(item).trim()).filter(Boolean) as PluginCapability[]
    : [];

  const frontendRaw = value.frontend && typeof value.frontend === "object"
    ? (value.frontend as Record<string, unknown>)
    : undefined;
  const backendRaw = value.backend && typeof value.backend === "object"
    ? (value.backend as Record<string, unknown>)
    : undefined;

  const commands = Array.isArray(value.commands)
    ? value.commands.map(parseCommandDescriptor)
    : [];

  const permissionsRaw = value.permissions && typeof value.permissions === "object"
    ? (value.permissions as Record<string, unknown>)
    : undefined;

  const contributionsRaw = value.contributions && typeof value.contributions === "object"
    ? (value.contributions as Record<string, unknown>)
    : undefined;

  return {
    id,
    version,
    displayName,
    description: typeof value.description === "string" ? value.description : undefined,
    pluginApiVersion,
    engines: {
      zeusAppBackend:
        typeof enginesRaw.zeusAppBackend === "string" && enginesRaw.zeusAppBackend.trim()
          ? enginesRaw.zeusAppBackend.trim()
          : undefined,
      zeusWeb:
        typeof enginesRaw.zeusWeb === "string" && enginesRaw.zeusWeb.trim()
          ? enginesRaw.zeusWeb.trim()
          : undefined,
    },
    capabilities,
    frontend:
      frontendRaw && typeof frontendRaw.entry === "string"
        ? { entry: frontendRaw.entry.trim() }
        : undefined,
    backend:
      backendRaw && typeof backendRaw.entry === "string"
        ? { entry: backendRaw.entry.trim() }
        : undefined,
    commands,
    permissions: permissionsRaw
      ? {
          allowedHttpHosts: Array.isArray(permissionsRaw.allowedHttpHosts)
            ? permissionsRaw.allowedHttpHosts.map((item) => String(item || "").trim()).filter(Boolean)
            : undefined,
          maxExecutionMs:
            permissionsRaw.maxExecutionMs === undefined
              ? undefined
              : Number(permissionsRaw.maxExecutionMs),
        }
      : undefined,
    contributions: contributionsRaw
      ? {
          editorBlocks: Array.isArray(contributionsRaw.editorBlocks)
            ? contributionsRaw.editorBlocks
              .map((item) => {
                if (!item || typeof item !== "object") return null;
                const record = item as Record<string, unknown>;
                const blockType = String(record.blockType || "").trim();
                const id = String(record.id || "").trim();
                const title = String(record.title || blockType || id).trim();
                if (!id || !blockType) return null;
                return {
                  id,
                  blockType,
                  title,
                  requiresBlockId: record.requiresBlockId === true,
                };
              })
              .filter((item): item is NonNullable<typeof item> => Boolean(item))
            : undefined,
          operations: Array.isArray(contributionsRaw.operations)
            ? contributionsRaw.operations
              .map((item) => {
                if (!item || typeof item !== "object") return null;
                const record = item as Record<string, unknown>;
                const id = String(record.id || "").trim();
                if (!id) return null;
                const riskLevel: PluginRiskLevel | undefined =
                  record.riskLevel === "low" || record.riskLevel === "medium" || record.riskLevel === "high"
                    ? record.riskLevel
                    : undefined;
                return {
                  id,
                  title: String(record.title || id).trim(),
                  description: String(record.description || id).trim(),
                  riskLevel,
                  requiresDocScope: record.requiresDocScope === true,
                };
              })
              .filter((item): item is NonNullable<typeof item> => Boolean(item))
            : undefined,
          menus: Array.isArray(contributionsRaw.menus)
            ? contributionsRaw.menus
              .map((item) => {
                if (!item || typeof item !== "object") return null;
                const record = item as Record<string, unknown>;
                const id = String(record.id || "").trim();
                const placement = String(record.placement || "").trim();
                if (!id || !placement) return null;
                return {
                  id,
                  placement: placement as "sidebar" | "document_header" | "settings",
                  title: String(record.title || id).trim(),
                  order: record.order === undefined ? undefined : Number(record.order),
                  icon: typeof record.icon === "string" ? record.icon : undefined,
                  action: typeof record.action === "string" ? record.action : undefined,
                  route: typeof record.route === "string" ? record.route : undefined,
                };
              })
              .filter((item): item is NonNullable<typeof item> => Boolean(item))
            : undefined,
          routes: Array.isArray(contributionsRaw.routes)
            ? contributionsRaw.routes
              .map((item) => {
                if (!item || typeof item !== "object") return null;
                const record = item as Record<string, unknown>;
                const id = String(record.id || "").trim();
                const path = String(record.path || "").trim();
                if (!id || !path) return null;
                return {
                  id,
                  path,
                  title: typeof record.title === "string" ? record.title : undefined,
                  order: record.order === undefined ? undefined : Number(record.order),
                };
              })
              .filter((item): item is NonNullable<typeof item> => Boolean(item))
            : undefined,
        }
      : undefined,
    integrity: typeof value.integrity === "string" ? value.integrity.trim() : undefined,
    signature: typeof value.signature === "string" ? value.signature.trim() : undefined,
  };
}

function parseCommandDescriptor(raw: unknown): PluginCommandDescriptor {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    id: String(value.id || "").trim(),
    command: String(value.command || "").trim(),
    name: String(value.name || value.command || "").trim(),
    description: String(value.description || value.command || "").trim(),
    category: typeof value.category === "string" ? value.category : undefined,
    requiresDocScope: value.requiresDocScope === true,
    operationId: String(value.operationId || "").trim(),
  };
}

export function validatePluginManifest(
  manifest: PluginManifest,
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
  if (manifest.pluginApiVersion !== PLUGIN_API_VERSION) {
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

  const commandSet = new Set<string>();
  for (const command of manifest.commands || []) {
    if (!command.id || !command.operationId || !command.command) {
      throw new Error(`Plugin ${manifest.id} has invalid command entry`);
    }
    if (!COMMAND_REGEX.test(command.command)) {
      throw new Error(`Plugin ${manifest.id} has invalid command name: ${command.command}`);
    }
    if (commandSet.has(command.command)) {
      throw new Error(`Plugin ${manifest.id} has duplicated command: ${command.command}`);
    }
    commandSet.add(command.command);
  }

  if ((manifest.permissions?.maxExecutionMs ?? 0) < 0) {
    throw new Error(`Plugin ${manifest.id} has invalid permissions.maxExecutionMs`);
  }
}

export function assertManifestIntegrity(
  manifest: PluginManifest,
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

export function verifyManifestSignature(
  manifest: PluginManifest,
  digest: string,
  publicKeyPem: string,
  requireSignature: boolean,
): void {
  const signature = manifest.signature || "";
  if (!signature) {
    if (requireSignature) {
      throw new Error(`Missing signature for ${manifest.id}@${manifest.version}`);
    }
    return;
  }

  if (!publicKeyPem) {
    if (requireSignature) {
      throw new Error("PLUGIN_STORE_PUBLIC_KEY_PEM is required when signature is enforced");
    }
    return;
  }

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${manifest.id}@${manifest.version}:${digest}`);
  verifier.end();

  const ok = verifier.verify(publicKeyPem, Buffer.from(signature, "base64"));
  if (!ok) {
    throw new Error(`Signature verification failed for ${manifest.id}@${manifest.version}`);
  }
}
