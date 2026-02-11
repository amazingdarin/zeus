import type { PluginCommandRuntimeItemV2 } from "./types.js";

export class PluginCommandExecutorV2 {
  constructor(
    private readonly resolveCommand: (
      userId: string,
      commandIdOrAlias: string,
    ) => Promise<PluginCommandRuntimeItemV2 | null>,
    private readonly executeResolvedCommand: (
      command: PluginCommandRuntimeItemV2,
      input: {
        userId: string;
        projectKey: string;
        args: Record<string, unknown>;
        source: "api" | "slash" | "palette" | "tool" | "hook";
        requestId?: string;
      },
    ) => Promise<Record<string, unknown>>,
    private readonly appendAudit: (input: {
      userId: string;
      pluginId: string;
      operationId: string;
      projectScope: string;
      status: string;
      durationMs: number;
      error?: string;
      eventType?: string;
      requestId?: string;
    }) => Promise<void>,
  ) {}

  async execute(input: {
    userId: string;
    projectKey: string;
    commandId: string;
    args?: Record<string, unknown>;
    source: "api" | "slash" | "palette" | "tool" | "hook";
    requestId?: string;
  }): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    const commandIdOrAlias = String(input.commandId || "").trim();
    if (!commandIdOrAlias) {
      throw new Error("commandId is required");
    }

    const command = await this.resolveCommand(input.userId, commandIdOrAlias);
    if (!command) {
      throw new Error(`Plugin command is not available: ${commandIdOrAlias}`);
    }
    if (input.source === "api" && command.apiEnabled === false) {
      throw new Error(`Plugin command ${command.commandId} is not enabled for API execution`);
    }

    const args = input.args && typeof input.args === "object"
      ? input.args
      : {};

    if (command.requiresDocScope) {
      const docId = typeof args.doc_id === "string" ? args.doc_id.trim() : "";
      if (!docId) {
        throw new Error(`Plugin command ${command.commandId} requires doc_id`);
      }
    }

    try {
      const result = await this.executeResolvedCommand(command, {
        userId: input.userId,
        projectKey: input.projectKey,
        args,
        source: input.source,
        requestId: input.requestId,
      });

      await this.appendAudit({
        userId: input.userId,
        pluginId: command.pluginId,
        operationId: command.commandId,
        projectScope: input.projectKey,
        status: "ok",
        durationMs: Date.now() - startedAt,
        eventType: "command.execute",
        requestId: input.requestId,
      });

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.appendAudit({
        userId: input.userId,
        pluginId: command.pluginId,
        operationId: command.commandId,
        projectScope: input.projectKey,
        status: "error",
        durationMs: Date.now() - startedAt,
        error: message,
        eventType: "command.execute",
        requestId: input.requestId,
      });
      throw err;
    }
  }
}
