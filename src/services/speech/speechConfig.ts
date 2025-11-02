// kilocode_change - new file: Consolidated speech configuration (FFmpeg, languages, errors)
import * as os from "os"

/**
 * FFmpeg configuration for platform-specific audio recording
 */
export interface FFmpegConfig {
	command: string
	fallbackPaths: string[]
	getArgs: (outputFile: string) => string[]
	dependencyName: string
	installCommand: string
	error: string
}

/**
 * Platform-specific FFmpeg configurations
 * Optimized for voice with WebM/Opus format (16kHz mono, 32kbps)
 */
const FFMPEG_CONFIGS: Record<string, FFmpegConfig> = {
	darwin: {
		command: "ffmpeg",
		fallbackPaths: ["/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"],
		getArgs: (outputFile: string) => [
			"-f",
			"avfoundation",
			"-i",
			":default",
			"-c:a",
			"libopus",
			"-b:a",
			"32k",
			"-application",
			"voip",
			"-ar",
			"16000",
			"-ac",
			"1",
			outputFile,
		],
		dependencyName: "FFmpeg",
		installCommand: "brew install ffmpeg",
		error: "FFmpeg is required for voice recording but is not installed.",
	},
	linux: {
		command: "ffmpeg",
		fallbackPaths: ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/snap/bin/ffmpeg"],
		getArgs: (outputFile: string) => [
			"-f",
			"alsa",
			"-i",
			"default",
			"-c:a",
			"libopus",
			"-b:a",
			"32k",
			"-application",
			"voip",
			"-ar",
			"16000",
			"-ac",
			"1",
			outputFile,
		],
		dependencyName: "FFmpeg",
		installCommand: "sudo apt-get update && sudo apt-get install -y ffmpeg",
		error: "FFmpeg is required for voice recording but is not installed.",
	},
	win32: {
		command: "ffmpeg",
		fallbackPaths: [
			"C:\\ffmpeg\\bin\\ffmpeg.exe",
			"C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
			"C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe",
		],
		getArgs: (outputFile: string) => [
			"-f",
			"wasapi",
			"-i",
			"audio=default",
			"-c:a",
			"libopus",
			"-b:a",
			"32k",
			"-application",
			"voip",
			"-ar",
			"16000",
			"-ac",
			"1",
			outputFile,
		],
		dependencyName: "FFmpeg",
		installCommand: "winget install Gyan.FFmpeg",
		error: "FFmpeg is required for voice recording but is not installed.",
	},
}

/**
 * Get FFmpeg configuration for current platform
 */
export function getFFmpegConfig(): FFmpegConfig | null {
	const platform = os.platform() as keyof typeof FFMPEG_CONFIGS
	return FFMPEG_CONFIGS[platform] || null
}

/**
 * Check if FFmpeg is available
 */
export async function checkFFmpegAvailability(): Promise<{ available: boolean; path?: string; error?: string }> {
	const config = getFFmpegConfig()
	if (!config) {
		return {
			available: false,
			error: `Audio recording not supported on platform: ${os.platform()}`,
		}
	}

	try {
		const { execSync } = await import("child_process")
		execSync(`${config.command} -version`, { stdio: "ignore" })
		return { available: true, path: config.command }
	} catch {
		// Check fallback paths
		for (const fallbackPath of config.fallbackPaths) {
			try {
				const { execSync } = await import("child_process")
				execSync(`"${fallbackPath}" -version`, { stdio: "ignore" })
				return { available: true, path: fallbackPath }
			} catch {
				continue
			}
		}
	}

	return { available: false, error: config.error }
}

/**
 * Supported languages for speech recognition
 */
export interface LanguageOption {
	name: string
	code: string
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
	{ name: "English", code: "en" },
	{ name: "Spanish (Español)", code: "es" },
	{ name: "French (Français)", code: "fr" },
	{ name: "German (Deutsch)", code: "de" },
	{ name: "Italian (Italiano)", code: "it" },
	{ name: "Portuguese (Português)", code: "pt" },
	{ name: "Chinese (中文)", code: "zh" },
	{ name: "Japanese (日本語)", code: "ja" },
	{ name: "Korean (한국어)", code: "ko" },
	{ name: "Russian (Русский)", code: "ru" },
	{ name: "Arabic (العربية)", code: "ar" },
	{ name: "Dutch (Nederlands)", code: "nl" },
	{ name: "Swedish (Svenska)", code: "sv" },
	{ name: "Danish (Dansk)", code: "da" },
	{ name: "Norwegian (Norsk)", code: "no" },
	{ name: "Finnish (Suomi)", code: "fi" },
	{ name: "Polish (Polski)", code: "pl" },
	{ name: "Turkish (Türkçe)", code: "tr" },
	{ name: "Hindi (हिन्दी)", code: "hi" },
	{ name: "Thai (ไทย)", code: "th" },
]

/**
 * User-friendly error messages
 */
export const ERROR_MESSAGES = {
	FFMPEG_NOT_FOUND: "FFmpeg is required for voice recording but is not installed.",
	PERMISSION_DENIED: "Microphone permission required. Please allow microphone access and try again.",
	RECORDING_FAILED: "Failed to start recording. Please check your microphone and try again.",
	TRANSCRIPTION_FAILED: "Failed to transcribe audio. Please check your internet connection and try again.",
	NETWORK_ERROR: "Network error. Please check your internet connection and try again.",
	AUTHENTICATION_FAILED: "Authentication failed. Please check your OpenAI API key.",
	INSUFFICIENT_CREDITS: "Insufficient OpenAI credits. Please check your account balance.",
	AUDIO_TOO_SHORT: "Audio recording is too short. Please speak for at least 1 second.",
	AUDIO_TOO_LONG: "Audio recording is too long. Please keep recordings under 5 minutes.",
	INVALID_AUDIO_FORMAT: "Invalid audio format. Please try recording again.",
	SERVER_ERROR: "Transcription server error. Please try again later.",
	UNKNOWN_ERROR: "An unknown error occurred. Please try again.",
}

/**
 * FFmpeg installation instructions by platform
 */
export const INSTALLATION_INSTRUCTIONS = {
	darwin: {
		title: "Install FFmpeg on macOS",
		command: "brew install ffmpeg",
		description: "FFmpeg is required for voice recording. Install it using Homebrew:",
		troubleshooting: [
			"If you don't have Homebrew, visit https://brew.sh",
			"Make sure Homebrew is in your PATH",
			"Restart Kilo Code after installing FFmpeg",
		],
	},
	linux: {
		title: "Install FFmpeg on Linux",
		command: "sudo apt-get update && sudo apt-get install -y ffmpeg",
		description: "FFmpeg is required for voice recording. Install it using your package manager:",
		troubleshooting: [
			"For other distributions, use yum, zypper, or your package manager",
			"Alternative: sudo snap install ffmpeg",
			"Restart Kilo Code after installing FFmpeg",
		],
	},
	win32: {
		title: "Install FFmpeg on Windows",
		command: "winget install Gyan.FFmpeg",
		description: "FFmpeg is required for voice recording. Install it using winget:",
		troubleshooting: [
			"Alternative: Download from https://ffmpeg.org/download.html",
			"Make sure FFmpeg is in your PATH environment variable",
			"Restart Kilo Code after installing FFmpeg",
		],
	},
}

/**
 * Get installation instructions for current platform
 */
export function getInstallationInstructions() {
	const platform = os.platform() as keyof typeof INSTALLATION_INSTRUCTIONS
	return INSTALLATION_INSTRUCTIONS[platform] || null
}

/**
 * Default speech settings
 */
export const DEFAULT_SETTINGS = {
	language: "en",
	maxRecordingDuration: 300, // 5 minutes in seconds
	chunkDuration: 3, // seconds
	overlapDuration: 1, // seconds
}
