import type {
	ExtensionAPI,
	Message,
	Model,
	// @ts-expect-error
} from "@earendil-works/pi-coding-agent";

export type { ExtensionAPI, Message, Model };

/** Config shape loaded from config/config.json (see config.example.json). */
export interface Config {
	cloudProvider?: string; // Cloud provider name (default: "anthropic")
	cloudModelId: string;
	localModelIds?: string[]; // Preferred local models in order; falls back to first available
	turnThreshold: number;
	struggleConsecutive: number;
	toolFailureThreshold: number;
	autoMode: boolean;
	strugglePatterns: string[];
}

/** Snapshot of struggle signals for a single turn, passed to the alert prompt. */
export interface TurnState {
	turnIndex: number;
	isStruggling: boolean;
	struggleReasons: string[];
	toolFailures: number;
}

// Shape expected by pi's getArgumentCompletions — not exported from pi,
// so we define it locally (matches pi-tui's AutocompleteItem).
export interface AutocompleteItem {
	value: string;
	label: string;
}
