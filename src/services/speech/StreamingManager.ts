// kilocode_change - new file: Streaming text deduplication and session management

import { IStreamingManager } from "./types"

/**
 * StreamingManager - Manages streaming transcription state and text deduplication
 *
 * Handles:
 * - Session text accumulation
 * - Word-level deduplication between overlapping chunks
 * - Previous chunk text tracking for overlap detection
 */
export class StreamingManager implements IStreamingManager {
	private sessionText: string = ""
	private previousChunkText: string = ""

	/**
	 * Add new chunk text with deduplication
	 * @param chunkId Chunk identifier (for logging)
	 * @param text Raw transcribed text from chunk
	 * @returns Deduplicated text that was added to session
	 */
	addChunkText(chunkId: number, text: string): string {
		// Deduplicate with previous chunk
		const deduplicatedText = this.deduplicateOverlap(this.previousChunkText, text)

		// Update previous chunk text for next iteration
		this.previousChunkText = text

		// Add to session text
		if (deduplicatedText) {
			this.sessionText += (this.sessionText ? " " : "") + deduplicatedText
			console.log(
				`[StreamingManager] Chunk ${chunkId}: Added ${deduplicatedText.length} chars, ` +
					`session total: ${this.sessionText.length} chars`,
			)
		} else {
			console.log(`[StreamingManager] Chunk ${chunkId}: No new text after deduplication`)
		}

		return deduplicatedText
	}

	/**
	 * Get accumulated session text
	 */
	getSessionText(): string {
		return this.sessionText
	}

	/**
	 * Get previous chunk text (for debugging)
	 */
	getPreviousChunkText(): string {
		return this.previousChunkText
	}

	/**
	 * Reset all state
	 */
	reset(): void {
		this.sessionText = ""
		this.previousChunkText = ""
		console.log("[StreamingManager] State reset")
	}

	/**
	 * Deduplicate overlapping text between chunks
	 *
	 * Strategy:
	 * - Compare last N words of previous text with first N words of current text
	 * - Find longest matching sequence (up to 5 words)
	 * - Return current text with overlap removed
	 *
	 * @param previousText Text from previous chunk
	 * @param currentText Text from current chunk
	 * @returns Current text with overlap removed
	 */
	private deduplicateOverlap(previousText: string, currentText: string): string {
		if (!previousText) {
			return currentText
		}

		const prevWords = previousText.trim().split(/\s+/)
		const currWords = currentText.trim().split(/\s+/)

		let overlapLength = 0
		const maxOverlap = Math.min(5, prevWords.length, currWords.length)

		// Find longest matching sequence
		for (let i = 1; i <= maxOverlap; i++) {
			const prevSuffix = prevWords.slice(-i).join(" ").toLowerCase()
			const currPrefix = currWords.slice(0, i).join(" ").toLowerCase()

			if (prevSuffix === currPrefix) {
				overlapLength = i
			}
		}

		if (overlapLength > 0) {
			console.log(
				`[StreamingManager] Detected ${overlapLength}-word overlap: ` +
					`"${currWords.slice(0, overlapLength).join(" ")}"`,
			)
		}

		return currWords.slice(overlapLength).join(" ")
	}
}
