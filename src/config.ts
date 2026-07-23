// @ts-expect-error
import { readFileSync, writeFileSync } from "node:fs";
// @ts-expect-error
import { dirname, join } from "node:path";
// @ts-expect-error
import { fileURLToPath } from "node:url";
import { DEFAULT_CLOUD_PROVIDER } from "./constants";
import type { Config } from "./types";

// Config lives in ../config/config.json relative to this source file.
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(EXTENSION_DIR, "../config/config.json");

function loadConfigFile(): Config {
	const raw = readFileSync(CONFIG_PATH, "utf-8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`invalid JSON in ${CONFIG_PATH}: ${msg}`);
	}
	return validateConfig(parsed);
}

/**
 * Validate the parsed config shape before it's trusted anywhere else.
 * Without this, a syntactically-valid-but-malformed config.json (e.g. a
 * missing/mistyped `strugglePatterns`) would pass loadConfigFile() and then
 * crash the turn_end handler on every turn instead of disabling monitoring
 * gracefully like a JSON parse failure does.
 */
function validateConfig(value: unknown): Config {
	if (typeof value !== "object" || value === null) {
		throw new Error("config must be a JSON object");
	}
	const cfg = value as Record<string, unknown>;

	if (typeof cfg.cloudModelId !== "string" || cfg.cloudModelId === "") {
		throw new Error("cloudModelId must be a non-empty string");
	}
	if (typeof cfg.turnThreshold !== "number") {
		throw new Error("turnThreshold must be a number");
	}
	if (typeof cfg.toolFailureThreshold !== "number") {
		throw new Error("toolFailureThreshold must be a number");
	}
	if (typeof cfg.autoMode !== "boolean") {
		throw new Error("autoMode must be a boolean");
	}
	if (
		!Array.isArray(cfg.strugglePatterns) ||
		!cfg.strugglePatterns.every((p: unknown) => typeof p === "string")
	) {
		throw new Error("strugglePatterns must be an array of strings");
	}
	if (
		cfg.cloudProvider !== undefined &&
		typeof cfg.cloudProvider !== "string"
	) {
		throw new Error("cloudProvider must be a string if set");
	}
	if (
		cfg.localModelIds !== undefined &&
		(!Array.isArray(cfg.localModelIds) ||
			!cfg.localModelIds.every((p: unknown) => typeof p === "string"))
	) {
		throw new Error("localModelIds must be an array of strings if set");
	}
	if (
		cfg.struggleConsecutive !== undefined &&
		typeof cfg.struggleConsecutive !== "number"
	) {
		throw new Error("struggleConsecutive must be a number if set");
	}

	return cfg as unknown as Config;
}

/**
 * Persist an in-memory config change (e.g. `/route-model auto`) back to
 * config.json, so it survives past this session instead of silently
 * reverting to the file's old value on the next restart.
 */
export function persistConfig(cfg: Config): void {
	try {
		writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, "utf-8");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[route-model] failed to persist config: ${msg}`);
	}
}

/** Resolve the configured cloud provider, falling back to the default. */
export function resolveCloudProvider(cfg: Config | undefined): string {
	return cfg?.cloudProvider || DEFAULT_CLOUD_PROVIDER;
}

/**
 * Creates a config resolver that lazily loads and caches config/config.json.
 * If loading fails once, it stops retrying and returns undefined from then
 * on (until reset()) — so a broken config disables monitoring with a single
 * warning instead of crash-looping.
 */
export function createConfigResolver() {
	let config: Config | undefined;
	let loadFailed = false;

	function resolve(): Config | undefined {
		if (loadFailed) return undefined;
		if (config !== undefined) return config;
		try {
			config = loadConfigFile();
			return config;
		} catch (err) {
			loadFailed = true;
			const msg = err instanceof Error ? err.message : String(err);
			console.error(
				`[route-model] config load failed, monitoring disabled: ${msg}`,
			);
			return undefined;
		}
	}

	/** Force a fresh reload on the next resolve() call. Used on session_start. */
	function reset(): void {
		config = undefined;
		loadFailed = false;
	}

	return { resolve, reset };
}

export type ConfigResolver = ReturnType<typeof createConfigResolver>;
