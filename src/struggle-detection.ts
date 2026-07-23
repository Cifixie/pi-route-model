import type { Config, Message } from "./types";

/**
 * Derive a "failure tag" from a tool result event: which specific thing
 * failed, so the same failing tool increments the streak.
 */
export function failureTag(event: any): string {
	if (event?.toolName) return `tool:${event.toolName}`;
	if (event?.toolCallId) return `call:${event.toolCallId}`;
	return "unknown";
}

/** Check if an assistant message signals struggle. Returns the matched patterns. */
export function detectStruggle(message: Message, cfg: Config): string[] {
	if (message.role !== "assistant") return [];
	const text = extractAssistantText(message);
	if (!text) return [];
	const matched: string[] = [];
	for (const pattern of cfg.strugglePatterns) {
		if (text.toLowerCase().includes(pattern)) matched.push(pattern);
	}
	return matched;
}

function extractAssistantText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	if (Array.isArray(message.content)) {
		const items = message.content as Array<{ type: string; text?: string }>;
		return items
			.filter((c) => c.type === "text")
			.map((c) => c.text ?? "")
			.join("\n");
	}
	return "";
}
