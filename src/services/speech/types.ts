// kilocode_change - new file: Speech service type definitions

import { ChildProcess } from "child_process"

/**
 * Speech service states
 */
export enum SpeechState {
	IDLE = "idle",
	RECORDING = "recording",
	TRANSCRIBING = "transcribing",
}

/**
 * Recording mode
 */
export enum RecordingMode {
	BATCH = "batch",
	STREAMING = "streaming",
}

/**
 * Streaming configuration
 */
export interface StreamingConfig {
	chunkDurationSeconds?: number // default 3
	overlapDurationSeconds?: number // default 1
	language?: string
	maxChunks?: number
}

/**
 * Audio chunk data for streaming
 */
export interface ChunkData {
	chunkId: number
	filePath: string
	startTime: number
	endTime: number
	sequenceNumber: number
}

/**
 * Progressive transcription result
 */
export interface ProgressiveResult {
	chunkId: number
	text: string
	isInterim: boolean
	confidence: number
	totalDuration: number
	sequenceNumber: number
}

/**
 * Volume sample for real-time audio level monitoring
 */
export interface VolumeSample {
	rmsDb: number // RMS level in dB (e.g., -22.4)
	peakDb: number // Peak level in dB (e.g., -3.1)
	linear: number // Normalized 0..1 value from rmsDb
	at: number // Milliseconds since recording start
}

/**
 * Transcription options
 */
export interface TranscriptionOptions {
	language?: string
	model?: string
	responseFormat?: "json" | "text" | "srt" | "verbose_json" | "vtt"
}

/**
 * Transcription result
 */
export interface TranscriptionResult {
	text: string
	language?: string
	duration?: number
	segments?: Array<{
		id: number
		start: number
		end: number
		text: string
	}>
}

/**
 * Audio converter interface
 */
export interface IAudioConverter {
	convertToMp3(webmPath: string): Promise<string>
	convertBatch(webmPaths: string[]): Promise<string[]>
}

/**
 * Transcription client interface
 */
export interface ITranscriptionClient {
	transcribe(audioPath: string, options?: TranscriptionOptions): Promise<string>
	transcribeBatch(audioPaths: string[], options?: TranscriptionOptions): Promise<string[]>
}

/**
 * Chunk processor events
 */
export interface ChunkProcessorEvents {
	chunkReady: (chunkPath: string) => void
	chunkError: (error: Error, chunkPath?: string) => void
	complete: () => void
}

/**
 * Chunk processor interface
 */
export interface IChunkProcessor {
	startWatching(ffmpegProcess: ChildProcess, outputDir: string): void
	stopWatching(): void
	on<K extends keyof ChunkProcessorEvents>(event: K, listener: ChunkProcessorEvents[K]): this
	off<K extends keyof ChunkProcessorEvents>(event: K, listener: ChunkProcessorEvents[K]): this
	emit<K extends keyof ChunkProcessorEvents>(event: K, ...args: Parameters<ChunkProcessorEvents[K]>): boolean
}

/**
 * Streaming manager interface
 */
export interface IStreamingManager {
	addChunkText(chunkId: number, text: string): string
	getSessionText(): string
	getPreviousChunkText(): string
	reset(): void
}
