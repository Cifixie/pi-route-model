// @ts-expect-error
import { readFileSync } from "node:fs";
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
	try {
		return JSON.parse(raw) as Config;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`invalid JSON in ${CONFIG_PATH}: ${msg}`);
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
