import fs from "node:fs/promises";

import semver from "semver";
import YAML from "yaml";

import type { ReleaseMatrix, ReleaseMatrixRelease } from "./types.js";

function assertObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
}

function assertSemver(value: string, label: string): void {
  if (!semver.valid(value)) {
    throw new Error(`Invalid semver for ${label}: ${value}`);
  }
}

function validateRelease(release: unknown): ReleaseMatrixRelease {
  assertObject(release, "Invalid release entry");
  const appVersion = release.app_version;
  const tracks = release.tracks;
  if (typeof appVersion !== "string") {
    throw new Error("Invalid release entry: app_version must be a string");
  }
  assertSemver(appVersion, "app_version");

  assertObject(tracks, `Invalid tracks for app_version ${appVersion}`);
  const validatedTracks: Record<string, string> = {};
  for (const [track, schemaVersion] of Object.entries(tracks)) {
    if (!track) {
      throw new Error(`Invalid track key for app_version ${appVersion}`);
    }
    if (typeof schemaVersion !== "string") {
      throw new Error(`Invalid schema version for track ${track} in app_version ${appVersion}`);
    }
    assertSemver(schemaVersion, `schema_version(${track})`);
    validatedTracks[track] = schemaVersion;
  }

  return {
    app_version: appVersion,
    tracks: validatedTracks,
  };
}

export function parseReleaseMatrix(raw: string): ReleaseMatrix {
  const parsed = YAML.parse(raw) as unknown;
  assertObject(parsed, "Invalid release matrix: root must be object");

  const version = parsed.version;
  if (typeof version !== "number") {
    throw new Error("Invalid release matrix: version must be number");
  }

  const targets = parsed.targets;
  assertObject(targets, "Invalid release matrix: targets must be object");
  const validatedTargets: Record<string, string[]> = {};
  for (const [targetName, trackList] of Object.entries(targets)) {
    if (!Array.isArray(trackList) || !trackList.every((item) => typeof item === "string" && item.length > 0)) {
      throw new Error(`Invalid release matrix: target ${targetName} must be string[]`);
    }
    validatedTargets[targetName] = [...trackList];
  }

  const releases = parsed.releases;
  if (!Array.isArray(releases) || releases.length === 0) {
    throw new Error("Invalid release matrix: releases must be non-empty array");
  }
  const validatedReleases = releases.map((entry) => validateRelease(entry));

  return {
    version,
    description: typeof parsed.description === "string" ? parsed.description : undefined,
    targets: validatedTargets,
    releases: validatedReleases,
  };
}

export async function loadReleaseMatrixFromFile(filePath: string): Promise<ReleaseMatrix> {
  const raw = await fs.readFile(filePath, "utf8");
  return parseReleaseMatrix(raw);
}

export function resolveTracksForTarget(matrix: ReleaseMatrix, target: string): string[] {
  const tracks = matrix.targets[target];
  if (!tracks || tracks.length === 0) {
    throw new Error(`Unknown target: ${target}`);
  }
  return [...tracks];
}

function resolveReleaseByAppVersion(matrix: ReleaseMatrix, appVersion: string): ReleaseMatrixRelease {
  const release = matrix.releases.find((item) => item.app_version === appVersion);
  if (!release) {
    throw new Error(`App version not found: ${appVersion}`);
  }
  return release;
}

export function resolveSchemaVersionForTrack(
  matrix: ReleaseMatrix,
  appVersion: string,
  track: string,
): string {
  const release = resolveReleaseByAppVersion(matrix, appVersion);
  const schemaVersion = release.tracks[track];
  if (!schemaVersion) {
    throw new Error(`Track ${track} missing in app version ${appVersion}`);
  }
  return schemaVersion;
}

