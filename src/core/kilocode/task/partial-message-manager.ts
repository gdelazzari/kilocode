/**
 * kilocode_change
 *
 * Partial Message Race Condition Fix
 *
 * This module addresses the deadlock issue that occurs when completing partial messages.
 * The problem: when a partial message is completed, it reuses the same timestamp, causing
 * lastMessageTs === capturedAskTs, which makes the pWaitFor condition always false.
 *
 * Solution: Multi-layered defense:
 * 1. Cleanup orphaned partial messages before creating new ones
 * 2. Add expiry time to partial message search
 * 3. Use separate synchronization for partial completions
 * 4. Timestamp equality check as safety net
 */

import pWaitFor from "p-wait-for"
import type { ClineMessage, ClineAsk, ClineSay } from "@roo-code/types"

// Default maximum age for partial messages (30 seconds)
const DEFAULT_PARTIAL_MAX_AGE_MS = 30000

interface PartialMessageState {
	messageTs: number
	isCompleting: boolean
	wasPartialCompletion: boolean
	originalTs?: number
}

/**
 * Manages partial message lifecycle and prevents race conditions
 */
export class PartialMessageManager {
	private partialStates = new Map<string, PartialMessageState>()
	private completionPromises = new Map<string, Promise<void>>()

	/**
	 * Register a partial message for tracking
	 */
	registerPartialMessage(messageKey: string, ts: number): void {
		this.partialStates.set(messageKey, {
			messageTs: ts,
			isCompleting: false,
			wasPartialCompletion: false,
		})
	}

	/**
	 * Mark a partial message as being completed
	 */
	startPartialCompletion(messageKey: string, originalTs: number): PartialMessageState {
		const state = this.partialStates.get(messageKey) || {
			messageTs: originalTs,
			isCompleting: true,
			wasPartialCompletion: true,
			originalTs: originalTs,
		}

		state.isCompleting = true
		state.wasPartialCompletion = true
		state.originalTs = originalTs

		this.partialStates.set(messageKey, state)
		return state
	}

	/**
	 * Complete a partial message and clean up state
	 */
	completePartialMessage(messageKey: string): void {
		const state = this.partialStates.get(messageKey)
		if (state) {
			state.isCompleting = false
			// Keep wasPartialCompletion flag for wait condition
		}
	}

	/**
	 * Get appropriate wait condition based on message type
	 */
	getWaitCondition(
		messageKey: string,
		askResponse: () => any,
		lastMessageTs: () => number,
		capturedAskTs: number,
	): () => boolean {
		const state = this.partialStates.get(messageKey)

		if (state?.wasPartialCompletion) {
			// For partial completions, only wait for user response
			// This prevents the timestamp equality deadlock
			return () => askResponse() !== undefined
		}

		// For regular messages, use dual condition
		return () => askResponse() !== undefined || lastMessageTs() !== capturedAskTs
	}

	/**
	 * Wait for response with appropriate condition
	 */
	async waitForResponse(
		messageKey: string,
		askResponse: () => any,
		lastMessageTs: () => number,
		capturedAskTs: number,
		options: { interval?: number; timeout?: number } = {},
	): Promise<void> {
		const condition = this.getWaitCondition(messageKey, askResponse, lastMessageTs, capturedAskTs)

		await pWaitFor(condition, {
			interval: options.interval || 100,
			timeout: options.timeout, // undefined means no timeout
		})

		// Clean up state after successful wait
		this.cleanupState(messageKey)
	}

	/**
	 * Clean up state for a message
	 */
	cleanupState(messageKey: string): void {
		this.partialStates.delete(messageKey)
		this.completionPromises.delete(messageKey)
	}

	/**
	 * Check if we should skip waiting (for safety check)
	 */
	shouldSkipWait(
		messageKey: string,
		askResponse: () => any,
		lastMessageTs: () => number,
		capturedAskTs: number,
	): boolean {
		const state = this.partialStates.get(messageKey)

		// Skip wait if completing partial and timestamps match (deadlock prevention)
		if (state?.wasPartialCompletion && lastMessageTs() === capturedAskTs) {
			// Only skip if response is already set
			return askResponse() !== undefined
		}

		return false
	}

	/**
	 * Generate a unique message key for tracking
	 */
	static generateMessageKey(type: ClineAsk, ts: number): string {
		return `${type}_${ts}`
	}
}

/**
 * Helper function to safely handle partial message completion in Task.ask()
 */
export async function handlePartialMessageCompletion(
	manager: PartialMessageManager,
	messageKey: string,
	askTs: number,
	askResponseGetter: () => any,
	lastMessageTsGetter: () => number,
	options?: { interval?: number },
): Promise<void> {
	// Check if we should skip waiting
	if (manager.shouldSkipWait(messageKey, askResponseGetter, lastMessageTsGetter, askTs)) {
		return
	}

	// Wait with appropriate condition
	await manager.waitForResponse(messageKey, askResponseGetter, lastMessageTsGetter, askTs, options)
}

/**
 * Utility to detect if a message is a partial completion
 */
export function isPartialCompletion(
	messages: ClineMessage[],
	type: ClineAsk,
	partial?: boolean,
): { isCompletion: boolean; originalMessage?: ClineMessage } {
	if (partial === false) {
		// Search for the most recent partial message of this type
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i]
			if (msg.type === "ask" && msg.ask === type && msg.partial === true) {
				return { isCompletion: true, originalMessage: msg }
			}
		}
	}

	return { isCompletion: false }
}

/**
 * Clean up orphaned partial messages that are older than the specified age.
 * This prevents stale partial messages from interfering with new message creation.
 *
 * @param messages - Array of messages to clean
 * @param type - The ask type to clean up
 * @param maxAgeMs - Maximum age in milliseconds (default: 30 seconds)
 * @returns True if any messages were cleaned up
 */
export function cleanupOrphanedPartialAsks(
	messages: ClineMessage[],
	type: ClineAsk,
	maxAgeMs = DEFAULT_PARTIAL_MAX_AGE_MS,
): boolean {
	const now = Date.now()
	let cleaned = false

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.type === "ask" && msg.ask === type && msg.partial === true) {
			const age = now - msg.ts
			if (age > maxAgeMs) {
				msg.partial = false
				cleaned = true
			}
		}
	}

	return cleaned
}

/**
 * Clean up orphaned partial say messages that are older than the specified age.
 *
 * @param messages - Array of messages to clean
 * @param type - The say type to clean up
 * @param maxAgeMs - Maximum age in milliseconds (default: 30 seconds)
 * @returns True if any messages were cleaned up
 */
export function cleanupOrphanedPartialSays(
	messages: ClineMessage[],
	type: ClineSay,
	maxAgeMs = DEFAULT_PARTIAL_MAX_AGE_MS,
): boolean {
	const now = Date.now()
	let cleaned = false

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.type === "say" && msg.say === type && msg.partial === true) {
			const age = now - msg.ts
			if (age > maxAgeMs) {
				msg.partial = false
				cleaned = true
			}
		}
	}

	return cleaned
}

/**
 * Complete ALL partial messages in the message array.
 * This is used when aborting streams to ensure no orphaned partials remain.
 *
 * @param messages - Array of messages to clean
 * @returns Number of messages that were completed
 */
export function completeAllPartialMessages(messages: ClineMessage[]): number {
	let count = 0

	for (const msg of messages) {
		if (msg.partial === true) {
			console.log(
				`[completeAllPartialMessages] Completing partial: ${msg.type}/${msg.ask || msg.say} (ts: ${msg.ts})`,
			)
			msg.partial = false
			count++
		}
	}

	return count
}
