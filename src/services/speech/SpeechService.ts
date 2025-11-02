// kilocode_change - refactored: Modular event-driven speech-to-text service
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"
import { spawn, ChildProcess } from "child_process"
import { tmpdir } from "os"
import { EventEmitter } from "events"

import { getFFmpegConfig, checkFFmpegAvailability } from "./speechConfig"
import { AudioConverter } from "./AudioConverter"
import { TranscriptionClient } from "./TranscriptionClient"
import { ChunkProcessor } from "./ChunkProcessor"
import { StreamingManager } from "./StreamingManager"
import { SpeechState, RecordingMode, StreamingConfig, ProgressiveResult, VolumeSample } from "./types"

/**
 * SpeechService - Orchestrates speech-to-text functionality
 *
 * Architecture:
 * - AudioConverter: Handles WebM → MP3 conversion
 * - TranscriptionClient: Manages OpenAI Whisper API calls
 * - ChunkProcessor: Event-driven FFmpeg chunk detection (eliminates race conditions)
 * - StreamingManager: Text deduplication and session management
 */
export class SpeechService extends EventEmitter {
	private static instance: SpeechService | null = null
	private state: SpeechState = SpeechState.IDLE
	private mode: RecordingMode = RecordingMode.BATCH

	// Module instances
	private audioConverter: AudioConverter
	private transcriptionClient: TranscriptionClient
	private chunkProcessor: ChunkProcessor
	private streamingManager: StreamingManager

	// FFmpeg process
	private ffmpegProcess: ChildProcess | null = null
	private recordingStartTime: number = 0
	private currentRecordingPath: string | null = null

	// Streaming state
	private streamingDir: string | null = null
	private chunkCounter: number = 0
	private streamingConfig: Required<StreamingConfig> = {
		chunkDurationSeconds: 3,
		overlapDurationSeconds: 1,
		language: "en",
		maxChunks: 0,
	}

	private constructor() {
		super()

		// Initialize modules
		this.audioConverter = new AudioConverter()
		this.transcriptionClient = new TranscriptionClient()
		this.chunkProcessor = new ChunkProcessor()
		this.streamingManager = new StreamingManager()

		// Set up chunk processor event handlers
		this.setupChunkProcessorEvents()
	}

	/**
	 * Set up event handlers for chunk processor
	 */
	private setupChunkProcessorEvents(): void {
		this.chunkProcessor.on("chunkReady", async (chunkPath: string) => {
			await this.handleChunkReady(chunkPath)
		})

		this.chunkProcessor.on("chunkError", (error: Error) => {
			console.error("[SpeechService] Chunk processing error:", error)
			this.emit("streamingError", error.message)
		})

		this.chunkProcessor.on("complete", () => {
			console.log("[SpeechService] FFmpeg process completed")
		})
	}

	public static getInstance(): SpeechService {
		if (!SpeechService.instance) {
			SpeechService.instance = new SpeechService()
		}
		return SpeechService.instance
	}

	/**
	 * Start batch recording
	 */
	public async startRecording(): Promise<{ success: boolean; error?: string }> {
		console.log("[SpeechService] 🎙️ START RECORDING (batch mode)")
		if (this.state === SpeechState.RECORDING) {
			console.log("[SpeechService] ❌ Already recording")
			return { success: false, error: "Already recording" }
		}

		try {
			this.state = SpeechState.RECORDING
			this.mode = RecordingMode.BATCH
			console.log("[SpeechService] ✓ State set to RECORDING, mode: BATCH")

			const ffmpegCheck = await checkFFmpegAvailability()
			if (!ffmpegCheck.available) {
				this.state = SpeechState.IDLE
				return { success: false, error: ffmpegCheck.error }
			}

			const tempDir = tmpdir()
			const recordingDir = path.join(tempDir, "KiloCode-recordings")
			await fs.mkdir(recordingDir, { recursive: true })

			const timestamp = Date.now()
			this.currentRecordingPath = path.join(recordingDir, `recording-${timestamp}.webm`)

			const config = getFFmpegConfig()
			if (!config) {
				this.state = SpeechState.IDLE
				return { success: false, error: `Unsupported platform: ${os.platform()}` }
			}

			const args = config.getArgs(this.currentRecordingPath)
			console.log("[SpeechService] 📝 Base FFmpeg args:", args.slice(0, 5), "...")
			// TEMPORARILY DISABLED: Volume meter to debug WebM format issues
			// args = this.augmentArgsWithVolumeMeter(args, "aout")
			// console.log("[SpeechService] 📝 Augmented with volume meter, total args:", args.length)

			this.ffmpegProcess = spawn(ffmpegCheck.path!, args, { stdio: ["ignore", "pipe", "pipe"] })
			this.recordingStartTime = Date.now()
			console.log("[SpeechService] 🚀 FFmpeg process spawned, PID:", this.ffmpegProcess.pid)

			// TEMPORARILY DISABLED: Volume parser to debug WebM format issues
			// this.attachVolumeParser(this.ffmpegProcess)
			// console.log("[SpeechService] 📊 Volume parser attached")

			return new Promise((resolve) => {
				if (!this.ffmpegProcess) {
					resolve({ success: false, error: "Failed to start FFmpeg" })
					return
				}

				this.ffmpegProcess.on("error", (error) => {
					this.resetState()
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
	 * Stop recording and transcribe
	 */
	public async stopRecordingAndTranscribe(): Promise<{ success: boolean; text?: string; error?: string }> {
		console.log("[SpeechService] 🛑 STOP RECORDING (batch mode)")
		if (this.state !== SpeechState.RECORDING || this.mode !== RecordingMode.BATCH) {
			console.log("[SpeechService] ❌ Not recording in batch mode, state:", this.state, "mode:", this.mode)
			return { success: false, error: "Not recording in batch mode" }
		}

		try {
			this.state = SpeechState.TRANSCRIBING
			console.log("[SpeechService] ✓ State set to TRANSCRIBING")

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

			if (!this.currentRecordingPath) {
				this.state = SpeechState.IDLE
				return { success: false, error: "No recording file" }
			}

			// Transcribe
			const text = await this.transcribeFile(this.currentRecordingPath)
			this.state = SpeechState.IDLE
			return { success: true, text }
		} catch (error) {
			this.state = SpeechState.IDLE
			return { success: false, error: error instanceof Error ? error.message : "Transcription failed" }
		}
	}

	/**
	 * Start streaming recording with live transcription
	 */
	public async startStreamingRecording(config?: StreamingConfig): Promise<{ success: boolean; error?: string }> {
		console.log("[SpeechService] 🎙️ START STREAMING RECORDING")
		if (this.state === SpeechState.RECORDING) {
			console.log("[SpeechService] ❌ Already recording")
			return { success: false, error: "Already recording" }
		}

		try {
			this.state = SpeechState.RECORDING
			this.mode = RecordingMode.STREAMING
			console.log("[SpeechService] ✓ State set to RECORDING, mode: STREAMING")

			// Merge config
			this.streamingConfig = {
				chunkDurationSeconds: config?.chunkDurationSeconds ?? 3,
				overlapDurationSeconds: config?.overlapDurationSeconds ?? 1,
				language: config?.language ?? "en",
				maxChunks: config?.maxChunks ?? 0,
			}

			if (this.streamingConfig.overlapDurationSeconds >= this.streamingConfig.chunkDurationSeconds) {
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
			console.log("[SpeechService] 📁 Chunk pattern:", chunkPattern)
			const args = this.buildStreamingArgs(ffmpegConfig, chunkPattern)
			console.log("[SpeechService] 📝 Streaming args built, count:", args.length)
			// TEMPORARILY DISABLED: Volume meter to debug WebM format issues
			// const meteredArgs = this.augmentArgsWithVolumeMeter(args, "aout")
			// console.log("[SpeechService] 📝 Augmented with volume meter, total args:", meteredArgs.length)

			this.ffmpegProcess = spawn(ffmpegCheck.path!, args, { stdio: ["ignore", "pipe", "pipe"] })
			this.recordingStartTime = Date.now()
			console.log("[SpeechService] 🚀 FFmpeg process spawned, PID:", this.ffmpegProcess.pid)

			// TEMPORARILY DISABLED: Volume parser to debug WebM format issues
			// this.attachVolumeParser(this.ffmpegProcess)
			// console.log("[SpeechService] 📊 Volume parser attached")
			this.chunkCounter = 0
			this.streamingManager.reset()
			console.log("[SpeechService] 🔄 Streaming state initialized")

			// Start watching for chunks with event-driven processor
			this.chunkProcessor.startWatching(this.ffmpegProcess, this.streamingDir)
			console.log("[SpeechService] 👀 Chunk processor started")

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
			this.mode = RecordingMode.BATCH
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
		console.log("[SpeechService] 🛑 STOP STREAMING RECORDING")
		if (this.state !== SpeechState.RECORDING || this.mode !== RecordingMode.STREAMING) {
			console.log("[SpeechService] ❌ Not streaming, state:", this.state, "mode:", this.mode)
			return { success: false, error: "Not streaming" }
		}

		try {
			this.state = SpeechState.TRANSCRIBING
			console.log("[SpeechService] ✓ State set to TRANSCRIBING")
			this.chunkProcessor.stopWatching()
			console.log("[SpeechService] ✓ Chunk processor stopped")

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
			const totalChunks = this.chunkCounter
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

			if (this.mode === RecordingMode.STREAMING) {
				this.resetStreamingState()
			} else {
				this.resetState()
			}

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
	 * Converts WebM to MP3 first for better OpenAI compatibility
	 */
	private async transcribeFile(filePath: string, language?: string): Promise<string> {
		// Convert WebM to MP3
		const mp3Path = await this.audioConverter.convertToMp3(filePath)

		try {
			// Transcribe using client
			const text = await this.transcriptionClient.transcribe(mp3Path, { language })
			return text
		} finally {
			// Clean up MP3 file
			try {
				await fs.unlink(mp3Path)
			} catch (error) {
				// Ignore cleanup errors
			}
		}
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
	 * Augment FFmpeg args with volume meter filter graph
	 * Adds astats filter to the audio stream for volume monitoring
	 */
	private augmentArgsWithVolumeMeter(baseArgs: string[], audioOutLabel = "aout"): string[] {
		const args = [...baseArgs]

		// Find output token (last argument is typically the output file/pattern)
		const outIndex = args.length - 1
		if (outIndex < 0) return args

		// Only add filter if not already present
		const hasFilter = args.includes("-filter_complex") || args.includes("-af") || args.includes("-vf")
		if (!hasFilter) {
			// Use -af (audio filter) instead of -filter_complex to avoid multiple outputs
			// astats will print volume levels to stderr while audio passes through to output
			// metadata=1 enables metadata output, reset=0.05 updates ~20 times/sec
			const audioFilter = "astats=metadata=1:reset=0.05,ametadata=print:key=lavfi.astats"

			// Insert audio filter before output file
			args.splice(outIndex, 0, "-af", audioFilter)
			console.log("[SpeechService] 📊 Added volume meter filter:", audioFilter)
		}

		return args
	}

	/**
	 * Attach volume parser to FFmpeg stderr
	 * Parses RMS and Peak levels from astats output and emits volumeUpdate events
	 */
	private attachVolumeParser(proc: ChildProcess): void {
		if (!proc || !proc.stderr) {
			console.log("[SpeechService] ⚠️ Cannot attach volume parser: no process or stderr")
			return
		}

		const rmsRe = /lavfi\.astats\.(?:Overall\.)?RMS_level=(-?\d+(?:\.\d+)?)/
		const peakRe = /lavfi\.astats\.(?:Overall\.)?Peak_level=(-?\d+(?:\.\d+)?)/

		let lastRms = Number.NaN
		let lastPeak = Number.NaN

		proc.stderr.on("data", (buf: Buffer) => {
			const text = buf.toString()
			// Log first few stderr lines to debug
			if (Math.random() < 0.01) {
				console.log("[SpeechService] 📊 FFmpeg stderr sample:", text.substring(0, 100))
			}

			// Capture most recent values visible in this chunk
			const rmsMatch = text.match(rmsRe)
			const peakMatch = text.match(peakRe)

			if (rmsMatch) lastRms = parseFloat(rmsMatch[1])
			if (peakMatch) lastPeak = parseFloat(peakMatch[1])

			// When we have at least RMS, emit an update
			if (!Number.isNaN(lastRms)) {
				// Convert dB to linear 0..1 scale: linear = 10^(dB/20)
				const linear = Math.max(0, Math.min(1, Math.pow(10, lastRms / 20)))
				const sample: VolumeSample = {
					rmsDb: lastRms,
					peakDb: Number.isNaN(lastPeak) ? lastRms : lastPeak,
					linear,
					at: Date.now() - this.recordingStartTime,
				}
				this.emit("volumeUpdate", sample)
			}
		})
	}

	/**
	 * Handle chunk ready event from ChunkProcessor
	 * This is called when FFmpeg has fully written and closed a chunk file
	 */
	private async handleChunkReady(chunkPath: string): Promise<void> {
		const chunkId = this.chunkCounter++
		console.log(`[SpeechService] 🔄 Processing chunk ${chunkId}: ${path.basename(chunkPath)}`)

		try {
			// Transcribe chunk
			const rawText = await this.transcribeFile(chunkPath, this.streamingConfig.language)
			console.log(`[SpeechService] ✓ Transcribed chunk ${chunkId}: ${rawText.substring(0, 50)}...`)

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

			console.log("[SpeechService] 📤 Emitting progressiveUpdate event")
			this.emit("progressiveUpdate", result)
			this.emit("chunkProcessed", chunkId, deduplicatedText)

			// Check max chunks limit
			if (this.streamingConfig.maxChunks > 0 && this.chunkCounter >= this.streamingConfig.maxChunks) {
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
	 * Reset state
	 */
	private resetState(): void {
		this.state = SpeechState.IDLE
		this.mode = RecordingMode.BATCH
		this.ffmpegProcess = null
		this.currentRecordingPath = null
		this.recordingStartTime = 0
	}

	/**
	 * Reset streaming state
	 */
	private resetStreamingState(): void {
		this.chunkProcessor.stopWatching()
		this.streamingManager.reset()
		this.state = SpeechState.IDLE
		this.mode = RecordingMode.BATCH
		this.ffmpegProcess = null
		this.streamingDir = null
		this.chunkCounter = 0
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
