import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

function collectSourceFiles(rootDir: string): string[] {
	const entries = readdirSync(rootDir, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = join(rootDir, entry.name);

		if (entry.isDirectory()) {
			files.push(...collectSourceFiles(fullPath));
			continue;
		}

		if (!entry.isFile()) {
			continue;
		}

		if (entry.name.endsWith(".d.ts")) {
			continue;
		}

		if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
			files.push(fullPath);
		}
	}

	return files;
}

const sourceFiles = collectSourceFiles("apps/web/src");
const directMessageImport =
	/import\s*\{[^}]*\bmessage\b[^}]*\}\s*from\s*["']antd["']/;
const staticModalConfirm = /\bModal\.confirm\s*\(/;

function collectViolations(pattern: RegExp) {
	return sourceFiles.filter((file) => pattern.test(readFileSync(file, "utf8")));
}

test("antd feedback uses App context instead of static message or modal APIs", () => {
	const messageViolations = collectViolations(directMessageImport);
	const modalViolations = collectViolations(staticModalConfirm);

	assert.deepEqual(
		messageViolations,
		[],
		`expected no direct antd message imports, found: ${messageViolations.join(", ")}`,
	);

	assert.deepEqual(
		modalViolations,
		[],
		`expected no static Modal.confirm usage, found: ${modalViolations.join(", ")}`,
	);
});
