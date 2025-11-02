import React from "react"
import { Mic } from "lucide-react"
import { StandardTooltip } from "@/components/ui"
import { cn } from "@/lib/utils"

interface MicrophoneButtonProps {
	isRecording: boolean
	onClick: () => void
	containerWidth: number
	disabled?: boolean
}

export const MicrophoneButton: React.FC<MicrophoneButtonProps> = ({
	isRecording,
	onClick,
	containerWidth,
	disabled = false,
}) => {
	return (
		<StandardTooltip content={isRecording ? "Stop Recording" : "Start Voice Recording"}>
			<button
				aria-label={isRecording ? "Stop Recording" : "Start Voice Recording"}
				disabled={disabled}
				onClick={onClick}
				className={cn(
					"relative inline-flex items-center justify-center",
					"bg-transparent border-none p-1.5",
					"rounded-md min-w-[28px] min-h-[28px]",
					"transition-all duration-150",
					"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
					"cursor-pointer",
					isRecording
						? "opacity-100 text-red-500 animate-pulse hover:text-red-600"
						: "opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)] active:bg-[rgba(255,255,255,0.1)]",
					{ hidden: containerWidth < 235 },
				)}>
				<Mic className="w-4 h-4" />
			</button>
		</StandardTooltip>
	)
}
