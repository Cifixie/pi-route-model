export const DEFAULT_TOOL_FAILURE_THRESHOLD = 3;

// Default to Anthropic if cloudProvider isn't specified in config.
export const DEFAULT_CLOUD_PROVIDER = "anthropic";

// Default consecutive-struggling-turns required before the struggle-phrase
// signal counts toward the alert, if struggleConsecutive isn't configured.
export const DEFAULT_STRUGGLE_CONSECUTIVE = 2;

// Known local-model provider names used as a last-resort fallback in
// findLocalModel(). Deliberately excludes provider names that commonly
// double as *cloud* providers (e.g. "openai") — those are only ever
// treated as local if they aren't the configured cloudProvider.
export const KNOWN_LOCAL_PROVIDERS = ["ollama", "lmstudio", "omlx"];
