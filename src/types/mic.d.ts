// kilocode_change - new file: TypeScript declarations for mic module
declare module "mic" {
	interface MicOptions {
		rate?: string
		channels?: string
		bitwidth?: string
		encoding?: string
		endian?: string
		device?: string
	}

	interface MicInstance {
		start(): void
		stop(): void
		pause(): void
		resume(): void
		getAudioStream(): NodeJS.ReadableStream
	}

	function mic(options?: MicOptions): MicInstance
	export = mic
}
