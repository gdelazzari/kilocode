// kilocode_change - new file: OpenAI Whisper API client for speech transcription

import * as fsSync from "fs"
import OpenAI from "openai"
import { ITranscriptionClient, TranscriptionOptions } from "./types"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"

/**
 * TranscriptionClient - Handles communication with OpenAI Whisper API
 */
export class TranscriptionClient implements ITranscriptionClient {
	private openai: OpenAI | null = null
	private providerSettingsManager: ProviderSettingsManager

	constructor(providerSettingsManager: ProviderSettingsManager) {
		this.providerSettingsManager = providerSettingsManager
	}

	/**
	 * Get or create OpenAI client instance
	 */
	private async getOpenAIClient(): Promise<OpenAI> {
		if (!this.openai) {
			const apiKey = await this.getOpenAiApiKey()
			if (!apiKey) {
				throw new Error(
					"OpenAI API key not configured. Please add an OpenAI or OpenAI-native provider in your settings.",
				)
			}

			this.openai = new OpenAI({
				apiKey,
				baseURL: await this.getOpenAiBaseUrl(),
			})
		}
		return this.openai
	}

	/**
	 * Transcribe a single audio file
	 * @param audioPath Path to the audio file (WebM format works directly with OpenAI)
	 * @param options Transcription options
	 * @returns Transcribed text
	 */
	async transcribe(audioPath: string, options?: TranscriptionOptions): Promise<string> {
		const openai = await this.getOpenAIClient()

		// Verify file exists and has content
		const stats = await fsSync.promises.stat(audioPath)

		if (stats.size === 0) {
			return "" // Empty file - happens when recording stops mid-chunk
		}

		// Skip very small files (less than 1KB) - likely incomplete/corrupted
		if (stats.size < 1024) {
			return ""
		}

		// WebM files with Opus codec work directly with OpenAI Whisper API
		// CRITICAL: Must use toFile() to preserve filename/extension for proper MIME type detection
		const fileName = audioPath.split("/").pop() || "audio.webm"

		// Create a File-like object with proper filename
		const audioFile = await import("openai").then((mod) => mod.toFile(fsSync.createReadStream(audioPath), fileName))

		const transcription = await openai.audio.transcriptions.create({
			file: audioFile,
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
	 * Get OpenAI API key by searching through ALL provider configurations
	 * Searches for any provider with type "openai" or "openai-native" and extracts the API key
	 */
	private async getOpenAiApiKey(): Promise<string | null> {
		try {
			// Get all provider configurations
			const allProfiles = await this.providerSettingsManager.listConfig()

			// Search for OpenAI or OpenAI-native providers
			for (const profile of allProfiles) {
				if (profile.apiProvider === "openai" || profile.apiProvider === "openai-native") {
					// Get the full profile with API key
					const fullProfile = await this.providerSettingsManager.getProfile({ id: profile.id })

					// Extract API key based on provider type
					if (profile.apiProvider === "openai" && fullProfile.openAiApiKey) {
						return fullProfile.openAiApiKey
					}

					if (profile.apiProvider === "openai-native" && fullProfile.openAiNativeApiKey) {
						return fullProfile.openAiNativeApiKey
					}
				}
			}

			return null
		} catch (error) {
			console.error("[TranscriptionClient] Error getting OpenAI API key:", error)
			return null
		}
	}

	/**
	 * Get OpenAI base URL from any OpenAI provider configuration
	 */
	private async getOpenAiBaseUrl(): Promise<string> {
		try {
			const allProfiles = await this.providerSettingsManager.listConfig()

			for (const profile of allProfiles) {
				if (profile.apiProvider === "openai" || profile.apiProvider === "openai-native") {
					const fullProfile = await this.providerSettingsManager.getProfile({ id: profile.id })

					if (profile.apiProvider === "openai" && fullProfile.openAiBaseUrl) {
						return fullProfile.openAiBaseUrl
					}

					if (profile.apiProvider === "openai-native" && fullProfile.openAiNativeBaseUrl) {
						return fullProfile.openAiNativeBaseUrl
					}
				}
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
