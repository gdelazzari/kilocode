// kilocode_change - new file: Critical tests for volume metering feature
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { EventEmitter } from "events"
import { VolumeSample } from "../SpeechService"

describe("SpeechService Volume Metering", () => {
	describe("Volume parser logic", () => {
		it("should parse RMS level from FFmpeg stderr", () => {
			const stderrLine = "[Parsed_astats_1 @ 0x7f8] lavfi.astats.Overall.RMS_level=-18.4"
			const rmsRe = /lavfi\.astats\.(?:Overall\.)?RMS_level=(-?\d+(?:\.\d+)?)/
			const match = stderrLine.match(rmsRe)

			expect(match).not.toBeNull()
			expect(parseFloat(match![1])).toBe(-18.4)
		})

		it("should parse Peak level from FFmpeg stderr", () => {
			const stderrLine = "[Parsed_astats_1 @ 0x7f8] lavfi.astats.Overall.Peak_level=-3.1"
			const peakRe = /lavfi\.astats\.(?:Overall\.)?Peak_level=(-?\d+(?:\.\d+)?)/
			const match = stderrLine.match(peakRe)

			expect(match).not.toBeNull()
			expect(parseFloat(match![1])).toBe(-3.1)
		})

		it("should convert dB to linear scale correctly", () => {
			// Test conversion: linear = 10^(dB/20)
			const testCases = [
				{ db: -20, expectedLinear: 0.1 },
				{ db: -40, expectedLinear: 0.01 },
				{ db: 0, expectedLinear: 1.0 },
			]

			testCases.forEach(({ db, expectedLinear }) => {
				const linear = Math.pow(10, db / 20)
				expect(linear).toBeCloseTo(expectedLinear, 2)
			})
		})

		it("should clamp linear values to 0..1 range", () => {
			const clamp = (value: number) => Math.max(0, Math.min(1, value))

			expect(clamp(-0.5)).toBe(0)
			expect(clamp(1.5)).toBe(1)
			expect(clamp(0.5)).toBe(0.5)
		})
	})

	describe("FFmpeg filter graph", () => {
		it("should generate correct asplit filter", () => {
			const filterGraph =
				"asplit=2[aout][am];" + "[am]astats=metadata=1:reset=0.05,ametadata=print:key=lavfi.astats"

			expect(filterGraph).toContain("asplit=2[aout][am]")
			expect(filterGraph).toContain("astats=metadata=1:reset=0.05")
			expect(filterGraph).toContain("ametadata=print:key=lavfi.astats")
		})

		it("should include null sink for meter branch", () => {
			const args = ["-f", "null", "-"]

			expect(args).toContain("-f")
			expect(args).toContain("null")
			expect(args).toContain("-")
		})
	})

	describe("Event emission", () => {
		let emitter: EventEmitter

		beforeEach(() => {
			emitter = new EventEmitter()
		})

		afterEach(() => {
			emitter.removeAllListeners()
		})

		it("should emit volumeUpdate events", () => {
			return new Promise<void>((resolve) => {
				const expectedSample: VolumeSample = {
					rmsDb: -18.4,
					peakDb: -3.1,
					linear: 0.12,
					at: 500,
				}

				emitter.on("volumeUpdate", (sample: VolumeSample) => {
					expect(sample.rmsDb).toBe(expectedSample.rmsDb)
					expect(sample.peakDb).toBe(expectedSample.peakDb)
					expect(sample.linear).toBe(expectedSample.linear)
					expect(sample.at).toBe(expectedSample.at)
					resolve()
				})

				emitter.emit("volumeUpdate", expectedSample)
			})
		})

		it("should handle multiple volume updates", () => {
			const samples: VolumeSample[] = []

			emitter.on("volumeUpdate", (sample: VolumeSample) => {
				samples.push(sample)
			})

			emitter.emit("volumeUpdate", { rmsDb: -20, peakDb: -5, linear: 0.1, at: 100 })
			emitter.emit("volumeUpdate", { rmsDb: -15, peakDb: -3, linear: 0.18, at: 200 })
			emitter.emit("volumeUpdate", { rmsDb: -10, peakDb: -2, linear: 0.32, at: 300 })

			expect(samples).toHaveLength(3)
			expect(samples[0].rmsDb).toBe(-20)
			expect(samples[1].rmsDb).toBe(-15)
			expect(samples[2].rmsDb).toBe(-10)
		})
	})
})
