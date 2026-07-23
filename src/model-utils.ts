import { DEFAULT_CLOUD_PROVIDER } from "./constants";
import type { Model } from "./types";

/** True if `model` is NOT from the configured cloud provider. */
export function isLocalModel(
	model: Model | undefined,
	cloudProvider: string,
): boolean {
	if (!model) return false;
	return !model.provider.toLowerCase().includes(cloudProvider.toLowerCase());
}

/**
 * Find a cloud model by the configured ID, or fall back to the first
 * available model from the cloud provider.
 */
export function findCloudModel(
	modelRegistry: any,
	cloudProvider: string,
	preferredId: string,
): Model | undefined {
	// First, try to find by the preferred ID.
	const byId = modelRegistry.find(cloudProvider, preferredId);
	if (byId) return byId;

	// Fall back to first available model from cloud provider.
	return modelRegistry
		.getAll()
		.find(
			(m: any) => m.provider.toLowerCase() === cloudProvider.toLowerCase(),
		);
}

/**
 * Find a local model: try preferred IDs from config first, then known
 * local providers, then any model that isn't the cloud provider.
 */
export function findLocalModel(
	modelRegistry: any,
	preferredIds?: string[],
	cloudProvider?: string,
): Model | undefined {
	// First, try preferred IDs from config.
	if (preferredIds && preferredIds.length > 0) {
		for (const id of preferredIds) {
			const m = modelRegistry.getAll().find((model: any) => model.id === id);
			if (m) return m;
		}
	}

	// Fallback: search by known local providers.
	const localProviders = ["omlx", "ollama", "lmstudio", "openai"];
	for (const provider of localProviders) {
		const models = modelRegistry
			.getAll()
			.filter((m: any) => m.provider === provider);
		if (models.length > 0) return models[0];
	}

	// Final fallback: any non-cloud-provider model.
	const cloudProv = (cloudProvider || DEFAULT_CLOUD_PROVIDER).toLowerCase();
	return modelRegistry
		.getAll()
		.find((m: any) => m.provider.toLowerCase() !== cloudProv);
}
