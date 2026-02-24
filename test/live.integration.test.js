import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractAndTranslateText } from "../src/pipeline.js";

const ONE_PIXEL_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+2KQAAAAASUVORK5CYII=";

const runLiveTests =
	process.env.RUN_LIVE_TESTS === "1" && Boolean(process.env.GEMINI_API_KEY);
const liveTest = runLiveTests ? test : test.skip;

const createdDirs = /** @type {string[]} */ ([]);

/**
 * Create temporary PNG input for live integration.
 * @returns {Promise<string>} Input image path.
 */
async function createTempPng() {
	const dir = await mkdtemp(path.join(tmpdir(), "tongues-live-"));
	createdDirs.push(dir);
	const filePath = path.join(dir, "input.png");
	await writeFile(filePath, Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));
	return filePath;
}

afterEach(async () => {
	const dirs = createdDirs.splice(0, createdDirs.length);
	await Promise.all(
		dirs.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("live integration (optional)", () => {
	liveTest(
		"extractAndTranslateText returns a valid response shape",
		async () => {
			const inputPath = await createTempPng();
			const rows = await extractAndTranslateText({
				inputPath,
				inputLang: "auto",
				outputLang: "english",
			});

			expect(Array.isArray(rows)).toBe(true);
			for (const row of rows) {
				expect(typeof row.sourceText).toBe("string");
				expect(typeof row.translatedText).toBe("string");
				if (row.sourceLanguage !== undefined) {
					expect(typeof row.sourceLanguage).toBe("string");
				}
			}
		},
	);
});
