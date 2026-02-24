import { describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");

/**
 * Parse PNG dimensions from IHDR chunk.
 * @param {Buffer} buffer PNG file bytes.
 * @returns {{ width: number; height: number }} Dimensions.
 * @throws {Error} If file is not a valid PNG.
 */
function getPngDimensions(buffer) {
	const pngSignature = "89504e470d0a1a0a";
	const signature = buffer.subarray(0, 8).toString("hex");
	if (signature !== pngSignature) {
		throw new Error("Not a valid PNG file.");
	}

	const width = buffer.readUInt32BE(16);
	const height = buffer.readUInt32BE(20);
	return { width, height };
}

describe("brand assets", () => {
	test("logo.png is exactly 1000x1000 PNG", async () => {
		const filePath = path.join(PROJECT_ROOT, "assets", "logo.png");
		const buffer = await readFile(filePath);
		const dimensions = getPngDimensions(buffer);

		expect(dimensions).toEqual({ width: 1000, height: 1000 });
	});

	test("social-share.png is exactly 1280x640 PNG under 1MB", async () => {
		const filePath = path.join(PROJECT_ROOT, "assets", "social-share.png");
		const [buffer, metadata] = await Promise.all([
			readFile(filePath),
			stat(filePath),
		]);
		const dimensions = getPngDimensions(buffer);

		expect(dimensions).toEqual({ width: 1280, height: 640 });
		expect(metadata.size).toBeLessThan(1_000_000);
	});
});
