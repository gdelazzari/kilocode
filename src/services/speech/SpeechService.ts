// kilocode_change - refactored: Modular event-driven speech-to-text service
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"
import { spawn, ChildProcess } from "child_process"
import { tmpdir } from "os"
import { EventEmitter } from "events"

import { getFFmpegConfig, checkFFmpegAvailability } from "./speechConfig"
import { TranscriptionClient } from "./TranscriptionClient"
import { ChunkProcessor } from "./ChunkProcessor"
import { StreamingManager } from "./StreamingManager"
import { SpeechState, StreamingConfig, ProgressiveResult, VolumeSample } from "./types"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"

// Re-export types for external use
export type { SpeechState, StreamingConfig, ProgressiveResult, VolumeSample } from "./types"

/**
 * SpeechService - Orchestrates speech-to-text functionality
 *
 * Architecture:
 * - TranscriptionClient: Manages OpenAI Whisper API calls (WebM format works directly!)
 * - ChunkProcessor: Event-driven FFmpeg chunk detection (eliminates race conditions)
 * - StreamingManager: Text deduplication and session management
 *
 * Note: WebM files with Opus codec are uploaded directly to OpenAI - no conversion needed!
 */
export class SpeechService extends EventEmitter {
	private static instance: SpeechService | null = null
	private state: SpeechState = SpeechState.IDLE

	// Module instances
	private transcriptionClient: TranscriptionClient
	private chunkProcessor: ChunkProcessor
	private streamingManager: StreamingManager

	// FFmpeg process
	private ffmpegProcess: ChildProcess | null = null
	private recordingStartTime: number = 0

	// Streaming state
	private streamingDir: string | null = null
	private processedChunks: number = 0
	private streamingConfig: Required<StreamingConfig> = {
		chunkDurationSeconds: 3,
		overlapDurationSeconds: 1,
		language: "en",
		maxChunks: 0,
	}

	private constructor(providerSettingsManager: ProviderSettingsManager) {
		super()

		// Initialize all modules with required dependencies
		this.transcriptionClient = new TranscriptionClient(providerSettingsManager)
		this.chunkProcessor = new ChunkProcessor()
		this.streamingManager = new StreamingManager()

		// Set up chunk processor event handlers
		this.setupChunkProcessorEvents()
	}

	/**
	 * Set up event handlers for chunk processor with proper error handling
	 */
	private setupChunkProcessorEvents(): void {
		this.chunkProcessor.on("chunkReady", async (chunkPath: string) => {
			try {
				await this.handleChunkReady(chunkPath)
			} catch (error) {
				console.error("[SpeechService] Error handling chunk:", error)
				this.emit("streamingError", error instanceof Error ? error.message : "Unknown error")
			}
		})

		this.chunkProcessor.on("chunkError", (error: Error) => {
			console.error("[SpeechService] Chunk processing error:", error)
			this.emit("streamingError", error.message)
		})

		this.chunkProcessor.on("complete", () => {
			// FFmpeg process completed
		})
	}

	public static getInstance(providerSettingsManager: ProviderSettingsManager): SpeechService {
		if (!SpeechService.instance) {
			SpeechService.instance = new SpeechService(providerSettingsManager)
		}
		return SpeechService.instance
	}

	/**
	 * Start streaming recording with live transcription
	 */
	public async startStreamingRecording(config?: StreamingConfig): Promise<{ success: boolean; error?: string }> {
		if (this.state === SpeechState.RECORDING) {
			return { success: false, error: "Already recording" }
		}

		try {
			this.state = SpeechState.RECORDING

			// Merge config
			this.streamingConfig = {
				chunkDurationSeconds: config?.chunkDurationSeconds ?? 3,
				overlapDurationSeconds: config?.overlapDurationSeconds ?? 1,
				language: config?.language ?? "en",
				maxChunks: config?.maxChunks ?? 0,
			}

			if (this.streamingConfig.overlapDurationSeconds >= this.streamingConfig.chunkDurationSeconds) {
				this.state = SpeechState.IDLE
				return { success: false, error: "Overlap must be less than chunk duration" }
			}

			const ffmpegCheck = await checkFFmpegAvailability()
			if (!ffmpegCheck.available) {
				this.state = SpeechState.IDLE
				return { success: false, error: ffmpegCheck.error }
			}

			// Create streaming directory
			const tempDir = tmpdir()
			const timestamp = Date.now()
			this.streamingDir = path.join(tempDir, `KiloCode-streaming-${timestamp}`)
			await fs.mkdir(this.streamingDir, { recursive: true })

			const ffmpegConfig = getFFmpegConfig()
			if (!ffmpegConfig) {
				this.state = SpeechState.IDLE
				return { success: false, error: `Unsupported platform: ${os.platform()}` }
			}

			// Build FFmpeg args for segmented output
			const chunkPattern = path.join(this.streamingDir, "chunk_%03d.webm")
			const args = this.buildStreamingArgs(ffmpegConfig, chunkPattern)

			this.ffmpegProcess = spawn(ffmpegCheck.path!, args, { stdio: ["ignore", "pipe", "pipe"] })
			this.recordingStartTime = Date.now()
			this.processedChunks = 0
			this.streamingManager.reset()

			// Start watching for chunks with event-driven processor
			this.chunkProcessor.startWatching(this.ffmpegProcess, this.streamingDir)

			return new Promise((resolve) => {
				if (!this.ffmpegProcess) {
					resolve({ success: false, error: "Failed to start FFmpeg" })
					return
				}

				this.ffmpegProcess.on("error", (error) => {
					this.resetStreamingState()
					this.emit("streamingError", error.message)
					resolve({ success: false, error: error.message })
				})

				setTimeout(() => {
					if (this.state === SpeechState.RECORDING) {
						resolve({ success: true })
					}
				}, 500)
			})
		} catch (error) {
			this.state = SpeechState.IDLE
			return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
		}
	}

	/**
	 * Stop streaming recording
	 */
	public async stopStreamingRecording(): Promise<{
		success: boolean
		finalText?: string
		totalChunks?: number
		error?: string
	}> {
		if (this.state !== SpeechState.RECORDING) {
			return { success: false, error: "Not recording" }
		}

		try {
			this.state = SpeechState.TRANSCRIBING

			// Stop chunk processor and wait for final chunk
			await this.chunkProcessor.stopWatching()

			// Stop FFmpeg
			if (this.ffmpegProcess) {
				this.ffmpegProcess.kill("SIGTERM")
				await new Promise<void>((resolve) => {
					const timeout = setTimeout(() => {
						if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
							this.ffmpegProcess.kill("SIGKILL")
						}
						resolve()
					}, 2000)

					if (this.ffmpegProcess) {
						this.ffmpegProcess.once("exit", () => {
							clearTimeout(timeout)
							resolve()
						})
					} else {
						clearTimeout(timeout)
						resolve()
					}
				})
				this.ffmpegProcess = null
			}

			// Get final text from streaming manager
			const totalChunks = this.processedChunks
			const finalText = this.streamingManager.getSessionText()

			this.emit("streamingComplete", finalText, totalChunks)
			this.resetStreamingState()

			return { success: true, finalText, totalChunks }
		} catch (error) {
			this.resetStreamingState()
			return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
		}
	}

	/**
	 * Cancel recording
	 */
	public async cancelRecording(): Promise<{ success: boolean; error?: string }> {
		if (this.state !== SpeechState.RECORDING) {
			return { success: false, error: "Not recording" }
		}

		try {
			if (this.ffmpegProcess) {
				this.ffmpegProcess.kill("SIGKILL")
				this.ffmpegProcess = null
			}

			this.resetStreamingState()
			return { success: true }
		} catch (error) {
			return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
		}
	}

	/**
	 * Get current state
	 */
	public getState(): SpeechState {
		return this.state
	}

	public isRecording(): boolean {
		return this.state === SpeechState.RECORDING
	}

	/**
	 * Transcribe audio file using modular transcription client
	 * WebM files work directly with OpenAI Whisper API - no conversion needed!
	 */
	private async transcribeFile(filePath: string, language?: string): Promise<string> {
		if (!this.transcriptionClient) {
			throw new Error(
				"TranscriptionClient not initialized. Please ensure ProviderSettingsManager is passed to SpeechService.getInstance()",
			)
		}

		// Upload WebM directly - OpenAI Whisper API accepts WebM with Opus codec
		const text = await this.transcriptionClient.transcribe(filePath, { language })
		return text
	}

	/**
	 * Build FFmpeg args for streaming
	 */
	private buildStreamingArgs(config: any, outputPattern: string): string[] {
		const baseArgs = config.getArgs(outputPattern)
		const segmentTime = this.streamingConfig.chunkDurationSeconds

		// Replace output file with segmented output
		const outputIndex = baseArgs.indexOf(outputPattern)
		if (outputIndex !== -1) {
			baseArgs.splice(
				outputIndex,
				0,
				"-f",
				"segment",
				"-segment_time",
				segmentTime.toString(),
				"-reset_timestamps",
				"1",
			)
		}

		return baseArgs
	}

	/**
	 * Handle chunk ready event from ChunkProcessor
	 * This is called when FFmpeg has fully written and closed a chunk file
	 */
	private async handleChunkReady(chunkPath: string): Promise<void> {
		const chunkId = this.processedChunks++

		try {
			// Transcribe chunk (WebM works directly with OpenAI)
			const rawText = await this.transcribeFile(chunkPath, this.streamingConfig.language)

			// Deduplicate and add to session
			const deduplicatedText = this.streamingManager.addChunkText(chunkId, rawText)

			// Emit progressive update
			const result: ProgressiveResult = {
				chunkId,
				text: this.streamingManager.getSessionText(),
				isInterim: false,
				confidence: 0.9,
				totalDuration: Date.now() - this.recordingStartTime,
				sequenceNumber: chunkId,
			}

			this.emit("progressiveUpdate", result)
			this.emit("chunkProcessed", chunkId, deduplicatedText)

			// Check max chunks limit
			if (this.streamingConfig.maxChunks > 0 && this.processedChunks >= this.streamingConfig.maxChunks) {
				await this.stopStreamingRecording()
			}
		} catch (error) {
			console.error(`[SpeechService] Error processing chunk ${chunkId}:`, error)
			this.emit(
				"streamingError",
				`Failed to process chunk: ${error instanceof Error ? error.message : "Unknown error"}`,
			)
		}
	}

	/**
	 * Reset streaming state
	 */
	private resetStreamingState(): void {
		this.chunkProcessor.stopWatching()
		this.streamingManager.reset()
		this.state = SpeechState.IDLE
		this.ffmpegProcess = null
		this.streamingDir = null
		this.processedChunks = 0
	}

	/**
	 * Dispose service
	 */
	public dispose(): void {
		if (this.ffmpegProcess) {
			this.ffmpegProcess.kill("SIGKILL")
		}
		this.resetStreamingState()
	}

	public static dispose(): void {
		if (SpeechService.instance) {
			SpeechService.instance.dispose()
			SpeechService.instance = null
		}
	}
}
