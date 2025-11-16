/**
 * Tests for partial message race condition fix
 * kilocode_change: Created to test partial message deadlock prevention
 */

import { describe, it, expect, beforeEach } from "vitest"
import { PartialMessageManager, isPartialCompletion, handlePartialMessageCompletion } from "../partial-message-manager"
import type { ClineMessage } from "@roo-code/types"

describe("PartialMessageManager", () => {
	let manager: PartialMessageManager

	beforeEach(() => {
		manager = new PartialMessageManager()
	})

	describe("Partial Message Tracking", () => {
		it("should register and track partial messages", () => {
			const messageKey = "tool_123456"
			manager.registerPartialMessage(messageKey, 123456)

			// Verify state is tracked by checking wait condition
			const condition = manager.getWaitCondition(
				messageKey,
				() => undefined,
				() => 123456,
				123456,
			)

			expect(condition).toBeDefined()
			expect(typeof condition).toBe("function")
		})

		it("should handle partial completion correctly", () => {
			const messageKey = "tool_123456"
			const originalTs = 123456

			const state = manager.startPartialCompletion(messageKey, originalTs)

			expect(state.wasPartialCompletion).toBe(true)
			expect(state.originalTs).toBe(originalTs)
			expect(state.isCompleting).toBe(true)
		})

		it("should complete partial message and update state", () => {
			const messageKey = "tool_123456"
			manager.startPartialCompletion(messageKey, 123456)

			manager.completePartialMessage(messageKey)

			// State should still exist but isCompleting should be false
			const condition = manager.getWaitCondition(
				messageKey,
				() => undefined,
				() => 123456,
				123456,
			)
			expect(condition).toBeDefined()
		})
	})

	describe("Wait Conditions", () => {
		it("should use single condition for partial completions", () => {
			const messageKey = "tool_123456"
			manager.startPartialCompletion(messageKey, 123456)

			let askResponse: any = undefined
			const condition = manager.getWaitCondition(
				messageKey,
				() => askResponse,
				() => 123456, // Same timestamp (would cause deadlock)
				123456,
			)

			// Should be false when no response
			expect(condition()).toBe(false)

			// Should be true when response is set
			askResponse = "yesButtonClicked"
			expect(condition()).toBe(true)
		})

		it("should use dual condition for regular messages", () => {
			const messageKey = "tool_789"
			let askResponse: any = undefined
			let lastMessageTs = 789

			const condition = manager.getWaitCondition(
				messageKey,
				() => askResponse,
				() => lastMessageTs,
				789,
			)

			// Initially false
			expect(condition()).toBe(false)

			// True when timestamp changes
			lastMessageTs = 790
			expect(condition()).toBe(true)

			// Reset and test response condition
			lastMessageTs = 789
			askResponse = "yesButtonClicked"
			expect(condition()).toBe(true)
		})

		it("should handle both conditions for regular messages", () => {
			const messageKey = "command_999"
			let askResponse: any = undefined
			let lastMessageTs = 999

			const condition = manager.getWaitCondition(
				messageKey,
				() => askResponse,
				() => lastMessageTs,
				999,
			)

			// False initially
			expect(condition()).toBe(false)

			// True when response is set (even with same timestamp)
			askResponse = "messageResponse"
			expect(condition()).toBe(true)

			// Reset response, change timestamp
			askResponse = undefined
			lastMessageTs = 1000
			expect(condition()).toBe(true)
		})
	})

	describe("Deadlock Prevention", () => {
		it("should detect and prevent timestamp reuse deadlock", () => {
			const messageKey = "tool_123456"
			const ts = 123456

			manager.startPartialCompletion(messageKey, ts)

			const shouldSkip = manager.shouldSkipWait(
				messageKey,
				() => "response", // Has response
				() => ts, // Same timestamp
				ts,
			)

			expect(shouldSkip).toBe(true)
		})

		it("should not skip wait when response is pending", () => {
			const messageKey = "tool_123456"
			const ts = 123456

			manager.startPartialCompletion(messageKey, ts)

			const shouldSkip = manager.shouldSkipWait(
				messageKey,
				() => undefined, // No response yet
				() => ts,
				ts,
			)

			expect(shouldSkip).toBe(false)
		})

		it("should not skip wait for regular messages even with same timestamp", () => {
			const messageKey = "tool_789"
			const ts = 789

			// Don't mark as partial completion

			const shouldSkip = manager.shouldSkipWait(
				messageKey,
				() => "response",
				() => ts,
				ts,
			)

			expect(shouldSkip).toBe(false)
		})
	})

	describe("State Cleanup", () => {
		it("should clean up state after completion", () => {
			const messageKey = "tool_123"
			manager.registerPartialMessage(messageKey, 123)

			manager.cleanupState(messageKey)

			// After cleanup, should behave like a regular message
			const condition = manager.getWaitCondition(
				messageKey,
				() => undefined,
				() => 123,
				123,
			)

			// Should use dual condition (regular message behavior)
			expect(condition()).toBe(false)
		})
	})

	describe("Message Key Generation", () => {
		it("should generate unique keys for different message types", () => {
			const key1 = PartialMessageManager.generateMessageKey("tool", 123)
			const key2 = PartialMessageManager.generateMessageKey("command", 123)
			const key3 = PartialMessageManager.generateMessageKey("tool", 456)

			expect(key1).toBe("tool_123")
			expect(key2).toBe("command_123")
			expect(key3).toBe("tool_456")
			expect(key1).not.toBe(key2)
			expect(key1).not.toBe(key3)
		})
	})
})

describe("isPartialCompletion", () => {
	it("should detect partial message completion", () => {
		const messages: ClineMessage[] = [
			{ type: "ask", ask: "tool", partial: true, ts: 123, text: "test" },
			{ type: "say", say: "checkpoint_saved", ts: 124, text: "checkpoint" },
		]

		const result = isPartialCompletion(messages, "tool", false)

		expect(result.isCompletion).toBe(true)
		expect(result.originalMessage?.ts).toBe(123)
	})

	it("should handle non-partial messages", () => {
		const messages: ClineMessage[] = []

		const result = isPartialCompletion(messages, "tool", undefined)

		expect(result.isCompletion).toBe(false)
		expect(result.originalMessage).toBeUndefined()
	})

	it("should not detect completion when partial is true", () => {
		const messages: ClineMessage[] = [{ type: "ask", ask: "tool", partial: true, ts: 123, text: "test" }]

		const result = isPartialCompletion(messages, "tool", true)

		expect(result.isCompletion).toBe(false)
	})

	it("should find the most recent partial message", () => {
		const messages: ClineMessage[] = [
			{ type: "ask", ask: "tool", partial: true, ts: 100, text: "old" },
			{ type: "say", say: "text", ts: 101, text: "something" },
			{ type: "ask", ask: "tool", partial: true, ts: 102, text: "recent" },
		]

		const result = isPartialCompletion(messages, "tool", false)

		expect(result.isCompletion).toBe(true)
		expect(result.originalMessage?.ts).toBe(102)
	})

	it("should handle checkpoint interruptions", () => {
		const messages: ClineMessage[] = [
			{ type: "ask", ask: "tool", partial: true, ts: 200, text: "partial" },
			{ type: "say", say: "checkpoint_saved", ts: 201, text: "checkpoint" },
			{ type: "say", say: "text", ts: 202, text: "other message" },
		]

		const result = isPartialCompletion(messages, "tool", false)

		expect(result.isCompletion).toBe(true)
		expect(result.originalMessage?.ts).toBe(200)
	})
})

describe("handlePartialMessageCompletion", () => {
	it("should skip wait when condition is already met", async () => {
		const manager = new PartialMessageManager()
		const messageKey = "tool_123"
		const ts = 123

		manager.startPartialCompletion(messageKey, ts)

		// Response is already set
		let askResponse: any = "yesButtonClicked"

		await handlePartialMessageCompletion(
			manager,
			messageKey,
			ts,
			() => askResponse,
			() => ts,
			{ interval: 10 },
		)

		// Should complete without waiting
		expect(askResponse).toBe("yesButtonClicked")
	})

	it("should wait for response when not yet set", async () => {
		const manager = new PartialMessageManager()
		const messageKey = "tool_456"
		const ts = 456

		manager.startPartialCompletion(messageKey, ts)

		let askResponse: any = undefined

		// Set response after a delay
		setTimeout(() => {
			askResponse = "yesButtonClicked"
		}, 50)

		await handlePartialMessageCompletion(
			manager,
			messageKey,
			ts,
			() => askResponse,
			() => ts,
			{ interval: 10 },
		)

		// Should have waited and received response
		expect(askResponse).toBe("yesButtonClicked")
	})
})
