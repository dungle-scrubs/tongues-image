import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const createdDirs = /** @type {string[]} */ ([]);

/**
 * Create a fake `sips` executable for deterministic cross-platform tests.
 * @returns {Promise<string>} Directory containing fake `sips`.
 */
async function createFakeSips() {
	const dir = await mkdtemp(path.join(tmpdir(), "tongues-fake-sips-"));
	createdDirs.push(dir);

	const scriptPath = path.join(dir, "sips");
	const script = `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);

const fail = (message) => {
\tconsole.error(message);
\tprocess.exit(2);
};

const readMeta = (filePath) => {
\tconst content = readFileSync(filePath, "utf8");
\tconst firstLine = content.split("\\n", 1)[0] || "";
\ttry {
\t\treturn JSON.parse(firstLine);
\t} catch {
\t\tfail(\`Invalid pseudo-image metadata in \${filePath}\`);
\t}
};

const writeMeta = (filePath, width, height) => {
\tconst targetBytes = Number(process.env.SIPS_FAKE_OUTPUT_BYTES || "2048");
\tconst header = JSON.stringify({ width, height }) + "\\n";
\tconst padding = targetBytes > header.length ? "x".repeat(targetBytes - header.length) : "";
\twriteFileSync(filePath, header + padding, "utf8");
};

if (args[0] === "--help") {
\tconsole.log("fake sips");
\tprocess.exit(0);
}

if (args[0] === "-g" && args[1] === "pixelWidth" && args[2] === "-g" && args[3] === "pixelHeight") {
\tconst filePath = args[4];
\tconst meta = readMeta(filePath);
\tconsole.log(filePath);
\tconsole.log(\`  pixelWidth: \${meta.width}\`);
\tconsole.log(\`  pixelHeight: \${meta.height}\`);
\tprocess.exit(0);
}

if (args[0] === "--cropToHeightWidth") {
\tconst cropHeight = Number(args[1]);
\tconst cropWidth = Number(args[2]);
\tconst outIndex = args.indexOf("--out");
\tif (outIndex === -1 || !args[outIndex + 1]) fail("Missing --out");
\twriteMeta(args[outIndex + 1], cropWidth, cropHeight);
\tprocess.exit(0);
}

if (args[0] === "-s" && args[1] === "format" && args[2] === "png" && args[3] === "-z") {
\tconst height = Number(args[4]);
\tconst width = Number(args[5]);
\tconst outIndex = args.indexOf("--out");
\tif (outIndex === -1 || !args[outIndex + 1]) fail("Missing --out");
\twriteMeta(args[outIndex + 1], width, height);
\tprocess.exit(0);
}

fail(\`Unsupported args: \${args.join(" ")}\`);
`;

	await writeFile(scriptPath, script, { encoding: "utf8", mode: 0o755 });
	return dir;
}

/**
 * Write a pseudo-image file consumed by fake `sips`.
 * @param {string} filePath Destination file.
 * @param {number} width Pixel width metadata.
 * @param {number} height Pixel height metadata.
 * @param {number=} bytes File size in bytes.
 * @returns {Promise<void>}
 */
async function writePseudoImage(filePath, width, height, bytes = 2048) {
	const header = `${JSON.stringify({ width, height })}\n`;
	const padding =
		bytes > header.length ? "x".repeat(bytes - header.length) : "";
	await writeFile(filePath, header + padding, "utf8");
}

/**
 * Read pseudo-image dimensions from metadata header.
 * @param {string} filePath File path.
 * @returns {Promise<{ width: number; height: number }>} Parsed dimensions.
 */
async function readPseudoImageMeta(filePath) {
	const content = await readFile(filePath, "utf8");
	const firstLine = content.split("\n", 1)[0] ?? "{}";
	const parsed = JSON.parse(firstLine);
	return { width: Number(parsed.width), height: Number(parsed.height) };
}

/**
 * Run a TypeScript script through Bun and capture output.
 * @param {string} scriptRelativePath Script path relative to project root.
 * @param {string[]} args Script args.
 * @param {Record<string, string | undefined>} envOverrides Extra env vars.
 * @returns {Promise<{ exitCode: number; stdout: string; stderr: string }>} Process result.
 */
async function runScript(scriptRelativePath, args, envOverrides) {
	const processHandle = Bun.spawn(["bun", scriptRelativePath, ...args], {
		cwd: PROJECT_ROOT,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			...envOverrides,
		},
	});

	const [exitCode, stdout, stderr] = await Promise.all([
		processHandle.exited,
		new Response(processHandle.stdout).text(),
		new Response(processHandle.stderr).text(),
	]);

	return { exitCode, stdout, stderr };
}

afterEach(async () => {
	const dirs = createdDirs.splice(0, createdDirs.length);
	await Promise.all(
		dirs.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("normalize-logo script", () => {
	test("normalizes output to 1000x1000 png", async () => {
		const fakeSipsDir = await createFakeSips();
		const workDir = await mkdtemp(path.join(tmpdir(), "normalize-logo-"));
		createdDirs.push(workDir);

		const inputPath = path.join(workDir, "input.jpg");
		const outputPath = path.join(workDir, "logo.png");
		await writePseudoImage(inputPath, 1600, 900);

		const result = await runScript(
			"scripts/normalize-logo.ts",
			["--input", inputPath, "--output", outputPath],
			{ PATH: `${fakeSipsDir}:${process.env.PATH ?? ""}` },
		);

		expect(result.exitCode).toBe(0);
		const meta = await readPseudoImageMeta(outputPath);
		expect(meta).toEqual({ width: 1000, height: 1000 });
	});

	test("fails when required args are missing", async () => {
		const fakeSipsDir = await createFakeSips();
		const result = await runScript("scripts/normalize-logo.ts", [], {
			PATH: `${fakeSipsDir}:${process.env.PATH ?? ""}`,
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"Usage: npx tsx ./scripts/normalize-logo.ts",
		);
	});

	test("fails when output extension is not png", async () => {
		const fakeSipsDir = await createFakeSips();
		const workDir = await mkdtemp(path.join(tmpdir(), "normalize-logo-ext-"));
		createdDirs.push(workDir);

		const inputPath = path.join(workDir, "input.jpg");
		const outputPath = path.join(workDir, "logo.jpg");
		await writePseudoImage(inputPath, 1600, 900);

		const result = await runScript(
			"scripts/normalize-logo.ts",
			["--input", inputPath, "--output", outputPath],
			{ PATH: `${fakeSipsDir}:${process.env.PATH ?? ""}` },
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Output must be a .png file.");
	});
});

describe("finalize-social-share script", () => {
	test("normalizes output to 1280x640 under 1MB", async () => {
		const fakeSipsDir = await createFakeSips();
		const workDir = await mkdtemp(path.join(tmpdir(), "finalize-social-"));
		createdDirs.push(workDir);

		const inputPath = path.join(workDir, "input.jpg");
		const outputPath = path.join(workDir, "social-share.png");
		await writePseudoImage(inputPath, 2000, 1200);

		const result = await runScript(
			"scripts/finalize-social-share.ts",
			["--input", inputPath, "--output", outputPath],
			{ PATH: `${fakeSipsDir}:${process.env.PATH ?? ""}` },
		);

		expect(result.exitCode).toBe(0);
		const meta = await readPseudoImageMeta(outputPath);
		expect(meta).toEqual({ width: 1280, height: 640 });
		const outputStat = await stat(outputPath);
		expect(outputStat.size).toBeLessThan(1_000_000);
	});

	test("fails when output exceeds 1MB", async () => {
		const fakeSipsDir = await createFakeSips();
		const workDir = await mkdtemp(path.join(tmpdir(), "finalize-social-size-"));
		createdDirs.push(workDir);

		const inputPath = path.join(workDir, "input.jpg");
		const outputPath = path.join(workDir, "social-share.png");
		await writePseudoImage(inputPath, 2000, 1200);

		const result = await runScript(
			"scripts/finalize-social-share.ts",
			["--input", inputPath, "--output", outputPath],
			{
				PATH: `${fakeSipsDir}:${process.env.PATH ?? ""}`,
				SIPS_FAKE_OUTPUT_BYTES: "1100001",
			},
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("social-share.png must be under 1MB");
	});

	test("fails when output extension is not png", async () => {
		const fakeSipsDir = await createFakeSips();
		const workDir = await mkdtemp(path.join(tmpdir(), "finalize-social-ext-"));
		createdDirs.push(workDir);

		const inputPath = path.join(workDir, "input.jpg");
		const outputPath = path.join(workDir, "social-share.jpg");
		await writePseudoImage(inputPath, 2000, 1200);

		const result = await runScript(
			"scripts/finalize-social-share.ts",
			["--input", inputPath, "--output", outputPath],
			{ PATH: `${fakeSipsDir}:${process.env.PATH ?? ""}` },
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Output must be a .png file.");
	});
});
