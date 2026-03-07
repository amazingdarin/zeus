import type { MigrationId } from "./types.js";

const MIGRATION_ID_PATTERN = /^(?<date>\d{8})-(?<seq>\d{3})-(?<schemaVersion>v\d+\.\d+\.\d+)$/;

export function parseMigrationId(id: string): MigrationId {
  const match = MIGRATION_ID_PATTERN.exec(id);
  if (!match?.groups) {
    throw new Error(`Invalid migration id: ${id}`);
  }
  return {
    id,
    date: match.groups.date,
    seqRaw: match.groups.seq,
    seq: Number.parseInt(match.groups.seq, 10),
    schemaVersion: match.groups.schemaVersion,
  };
}

export function compareParsedMigrationIds(left: MigrationId, right: MigrationId): number {
  if (left.date !== right.date) {
    return left.date.localeCompare(right.date);
  }
  if (left.seq !== right.seq) {
    return left.seq - right.seq;
  }
  return left.id.localeCompare(right.id);
}

export function compareMigrationIds(leftId: string, rightId: string): number {
  return compareParsedMigrationIds(parseMigrationId(leftId), parseMigrationId(rightId));
}

