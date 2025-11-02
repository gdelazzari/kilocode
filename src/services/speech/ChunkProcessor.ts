// kilocode_change - new file: Event-driven FFmpeg chunk processor

import { EventEmitter } from "events"
import { ChildProcess } from "child_process"
import * as path from "path"
import { IChunkProcessor } from "./types"

/**
 * ChunkProcessor - Event-driven FFmpeg chunk detection
 *
 * This module solves the race condition problem by parsing FFmpeg's stderr
 * output to detect when chunks are fully written and closed, rather than
 * polling for file existence and using arbitrary timeouts.
 *
 * Events:
 * - 'chunkReady': Emitted when a chunk is fully written and closed by FFmpeg
 * - 'chunkError': Emitted when an error occurs processing a chunk
 * - 'complete': Emitted when FFmpeg process exits
 */
export class ChunkProcessor extends EventEmitter implements IChunkProcessor {
	private ffmpegProcess: ChildProcess | null = null
	private outputDir: string = ""
	private isWatching: boolean = false

	/**
	 * Start watching FFmpeg stderr for chunk completion events
	 * @param ffmpegProcess The FFmpeg child process to monitor
	 * @param outputDir Directory where chunks are being written
	 */
	startWatching(ffmpegProcess: ChildProcess, outputDir: string): void {
		if (this.isWatching) {
			console.warn("[ChunkProcessor] Already watching, stopping previous watch")
			this.stopWatching()
		}

		this.ffmpegProcess = ffmpegProcess
		this.outputDir = outputDir
		this.isWatching = true

		console.log("[ChunkProcessor] 👀 Started watching FFmpeg stderr for chunk events")

		// Attach stderr parser
		if (ffmpegProcess.stderr) {
			ffmpegProcess.stderr.on("data", this.handleStderrData.bind(this))
		} else {
			console.error("[ChunkProcessor] ❌ No stderr stream available")
		}

		// Handle process exit
		ffmpegProcess.on("exit", (code, signal) => {
			console.log(`[ChunkProcessor] FFmpeg exited with code ${code}, signal ${signal}`)
			this.emit("complete")
			this.stopWatching()
		})

		// Handle process errors
		ffmpegProcess.on("error", (error) => {
			console.error("[ChunkProcessor] FFmpeg process error:", error)
			this.emit("chunkError", error)
			this.stopWatching()
		})
	}

	/**
	 * Stop watching FFmpeg stderr
	 */
	stopWatching(): void {
		if (!this.isWatching) {
			return
		}

		console.log("[ChunkProcessor] 🛑 Stopped watching FFmpeg stderr")

		if (this.ffmpegProcess?.stderr) {
			this.ffmpegProcess.stderr.removeAllListeners("data")
		}

		if (this.ffmpegProcess) {
			this.ffmpegProcess.removeAllListeners("exit")
			this.ffmpegProcess.removeAllListeners("error")
		}

		this.ffmpegProcess = null
		this.outputDir = ""
		this.isWatching = false
	}

	/**
	 * Handle FFmpeg stderr data
	 * Parses output for chunk completion signals
	 */
	private handleStderrData(data: Buffer): void {
		const text = data.toString()

		// FFmpeg outputs different messages depending on the muxer and format
		// For segment muxer with WebM output, we look for:
		// 1. "Opening 'chunk_XXX.webm' for writing" - chunk file created
		// 2. "Closing 'chunk_XXX.webm'" - chunk file closed (READY TO PROCESS)
		// 3. "[segment @ ...] segment:'chunk_XXX.webm' count:N ended" - segment completed

		// Pattern 1: Detect chunk file closure (most reliable signal)
		const closingMatch = text.match(/Closing '([^']+)'/i)
		if (closingMatch) {
			const fileName = closingMatch[1]
			// Extract just the filename if it's a full path
			const chunkFileName = path.basename(fileName)

			if (chunkFileName.startsWith("chunk_") && chunkFileName.endsWith(".webm")) {
				const chunkPath = path.join(this.outputDir, chunkFileName)
				console.log(`[ChunkProcessor] ✅ Chunk closed by FFmpeg: ${chunkFileName}`)
				this.emit("chunkReady", chunkPath)
				return
			}
		}

		// Pattern 2: Detect segment completion (alternative signal)
		const segmentMatch = text.match(/segment:'([^']+)'.*ended/i)
		if (segmentMatch) {
			const fileName = segmentMatch[1]
			const chunkFileName = path.basename(fileName)

			if (chunkFileName.startsWith("chunk_") && chunkFileName.endsWith(".webm")) {
				const chunkPath = path.join(this.outputDir, chunkFileName)
				console.log(`[ChunkProcessor] ✅ Segment ended: ${chunkFileName}`)
				this.emit("chunkReady", chunkPath)
				return
			}
		}

		// Log other stderr output for debugging (sample 1% of messages to avoid spam)
		if (Math.random() < 0.01) {
			const preview = text.substring(0, 100).replace(/\n/g, " ")
			console.log(`[ChunkProcessor] 📊 FFmpeg stderr sample: ${preview}`)
		}
	}

	/**
	 * Check if currently watching
	 */
	isActive(): boolean {
		return this.isWatching
	}
}
