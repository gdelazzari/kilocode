// kilocode_change - new file: Audio format converter for speech service

import { spawn } from "child_process"
import { IAudioConverter } from "./types"

/**
 * AudioConverter - Handles WebM to MP3 conversion using FFmpeg
 * OpenAI's Whisper API is more reliable with MP3 format
 */
export class AudioConverter implements IAudioConverter {
	/**
	 * Convert a single WebM file to MP3
	 * @param webmPath Path to the WebM file
	 * @returns Path to the converted MP3 file
	 */
	async convertToMp3(webmPath: string): Promise<string> {
		const mp3Path = webmPath.replace(/\.webm$/, ".mp3")

		return new Promise((resolve, reject) => {
			const ffmpeg = spawn("ffmpeg", [
				"-y", // Overwrite output file
				"-i",
				webmPath,
				"-vn", // No video
				"-ar",
				"16000", // 16kHz sample rate
				"-ac",
				"1", // Mono
				"-b:a",
				"32k", // 32kbps bitrate
				"-f",
				"mp3",
				mp3Path,
			])

			let stderrOutput = ""

			// Capture stderr for debugging
			if (ffmpeg.stderr) {
				ffmpeg.stderr.on("data", (data) => {
					stderrOutput += data.toString()
				})
			}

			ffmpeg.on("error", (error) => {
				reject(new Error(`FFmpeg conversion failed: ${error.message}`))
			})

			ffmpeg.on("exit", (code) => {
				if (code === 0) {
					resolve(mp3Path)
				} else {
					console.error("[AudioConverter] FFmpeg conversion failed:")
					console.error("[AudioConverter] Exit code:", code)
					console.error("[AudioConverter] stderr:", stderrOutput)
					reject(new Error(`FFmpeg conversion failed with code ${code}`))
				}
			})
		})
	}

	/**
	 * Convert multiple WebM files to MP3 in parallel
	 * @param webmPaths Array of WebM file paths
	 * @returns Array of MP3 file paths
	 */
	async convertBatch(webmPaths: string[]): Promise<string[]> {
		return Promise.all(webmPaths.map((path) => this.convertToMp3(path)))
	}
}
