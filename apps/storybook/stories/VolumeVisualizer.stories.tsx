import type { Meta, StoryObj } from "@storybook/react-vite"
import { VolumeVisualizer } from "@/components/chat/VolumeVisualizer"
import { useEffect, useState } from "react"

const meta = {
	title: "Components/VolumeVisualizer",
	component: VolumeVisualizer,
	parameters: {
		layout: "centered",
	},
	argTypes: {
		volume: {
			control: { type: "range", min: 0, max: 1, step: 0.01 },
			description: "Volume level from 0 to 1",
		},
		isActive: {
			control: "boolean",
			description: "Whether recording is active (affects color)",
		},
	},
} satisfies Meta<typeof VolumeVisualizer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		volume: 0.5,
		isActive: true,
	},
}

export const Inactive: Story = {
	args: {
		volume: 0.3,
		isActive: false,
	},
}

export const Silent: Story = {
	args: {
		volume: 0,
		isActive: true,
	},
}

export const Loud: Story = {
	args: {
		volume: 1,
		isActive: true,
	},
}

/**
 * Animated demo that simulates real-time volume changes
 */
export const AnimatedDemo: Story = {
	parameters: {
		chromatic: { disableSnapshot: true },
	},
	render: (args) => {
		const [volume, setVolume] = useState(0)

		useEffect(() => {
			let time = 0
			const interval = setInterval(() => {
				time += 0.1
				// Simulate varying volume with sine wave + randomness
				const baseVolume = (Math.sin(time) + 1) / 2 // 0 to 1
				const randomness = Math.random() * 0.3
				const newVolume = Math.max(0, Math.min(1, baseVolume + randomness))
				setVolume(newVolume)
			}, 50) // Update every 50ms (~20 times per second)

			return () => clearInterval(interval)
		}, [])

		return <VolumeVisualizer {...args} volume={volume} />
	},
	args: {
		volume: 0,
		isActive: true,
	},
}

/**
 * Simulates speech patterns with varying intensity
 */
export const SpeechPattern: Story = {
	parameters: {
		chromatic: { disableSnapshot: true },
	},
	render: (args) => {
		const [volume, setVolume] = useState(0)

		useEffect(() => {
			let time = 0
			const interval = setInterval(() => {
				time += 0.15
				// Simulate speech: bursts of activity followed by pauses
				const speechCycle = Math.sin(time * 0.5) // Slow wave for speech/pause pattern
				const microVariation = Math.sin(time * 3) * 0.3 // Fast variation during speech
				const isSpeak = speechCycle > -0.3 // Speaking 65% of the time

				if (isSpeak) {
					const baseVolume = (speechCycle + 0.3) / 1.3 // Normalize to 0-1
					const newVolume = Math.max(0.2, Math.min(1, baseVolume + microVariation))
					setVolume(newVolume)
				} else {
					setVolume(Math.max(0, volume * 0.8)) // Decay to silence
				}
			}, 50)

			return () => clearInterval(interval)
		}, [])

		return <VolumeVisualizer {...args} volume={volume} />
	},
	args: {
		volume: 0,
		isActive: true,
	},
}
