// kilocode_change - new file: OpenAI Whisper API client for speech transcription

import * as fsSync from "fs"
import OpenAI from "openai"
import { ITranscriptionClient, TranscriptionOptions } from "./types"
import { ContextProxy } from "../../core/config/ContextProxy"

/**
 * TranscriptionClient - Handles communication with OpenAI Whisper API
 */
export class TranscriptionClient implements ITranscriptionClient {
	private openai: OpenAI | null = null

	/**
	 * Get or create OpenAI client instance
	 */
	private getOpenAIClient(): OpenAI {
		if (!this.openai) {
			const apiKey = this.getOpenAiApiKey()
			if (!apiKey) {
				throw new Error("OpenAI API key not configured")
			}

			this.openai = new OpenAI({
				apiKey,
				baseURL: this.getOpenAiBaseUrl(),
			})
		}
		return this.openai
	}

	/**
	 * Transcribe a single audio file
	 * @param audioPath Path to the audio file (MP3 format recommended)
	 * @param options Transcription options
	 * @returns Transcribed text
	 */
	async transcribe(audioPath: string, options?: TranscriptionOptions): Promise<string> {
		const openai = this.getOpenAIClient()

		// Use fs.createReadStream for Node.js file upload
		const audioStream = fsSync.createReadStream(audioPath)

		const transcription = await openai.audio.transcriptions.create({
			file: audioStream,
			model: options?.model || "whisper-1",
			language: options?.language || undefined,
			response_format: options?.responseFormat || "verbose_json",
		})

		if (!transcription.text?.trim()) {
			throw new Error("No transcription text received")
		}

		return transcription.text.trim()
	}

	/**
	 * Transcribe multiple audio files in parallel
	 * @param audioPaths Array of audio file paths
	 * @param options Transcription options
	 * @returns Array of transcribed texts
	 */
	async transcribeBatch(audioPaths: string[], options?: TranscriptionOptions): Promise<string[]> {
		return Promise.all(audioPaths.map((path) => this.transcribe(path, options)))
	}

	/**
	 * Get OpenAI API key from context
	 * Uses getValues() which merges globalState and secretState
	 */
	private getOpenAiApiKey(): string | null {
		try {
			const contextProxy = ContextProxy.instance
			const allValues = contextProxy.getValues()

			// Check for OpenAI provider keys
			if (allValues.apiProvider === "openai" && allValues.openAiApiKey) {
				return allValues.openAiApiKey
			}

			if (allValues.apiProvider === "openai-native" && allValues.openAiNativeApiKey) {
				return allValues.openAiNativeApiKey
			}

			// Fallback: check for any OpenAI key regardless of current provider
			if (allValues.openAiApiKey) {
				return allValues.openAiApiKey
			}

			if (allValues.openAiNativeApiKey) {
				return allValues.openAiNativeApiKey
			}

			console.error("[TranscriptionClient] ❌ No OpenAI API key found")
			return null
		} catch (error) {
			console.error("[TranscriptionClient] ❌ Error getting OpenAI API key:", error)
			return null
		}
	}

	/**
	 * Get OpenAI base URL
	 */
	private getOpenAiBaseUrl(): string {
		try {
			const contextProxy = ContextProxy.instance
			const providerSettings = contextProxy.getProviderSettings()

			if (providerSettings.apiProvider === "openai" && providerSettings.openAiBaseUrl) {
				return providerSettings.openAiBaseUrl
			}

			if (providerSettings.apiProvider === "openai-native" && providerSettings.openAiNativeBaseUrl) {
				return providerSettings.openAiNativeBaseUrl
			}

			return "https://api.openai.com/v1"
		} catch {
			return "https://api.openai.com/v1"
		}
	}

	/**
	 * Reset the client (useful for testing or when API key changes)
	 */
	reset(): void {
		this.openai = null
	}
}
