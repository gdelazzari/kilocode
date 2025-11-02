# Dictation Service Implementation

## Overview

The Speech Service provides real-time speech-to-text functionality using FFmpeg for audio recording and OpenAI Whisper API for transcription. The system supports both batch and streaming modes with progressive transcription.

## Architecture

### Core Components

1. **SpeechService** (`src/services/speech/SpeechService.ts`)

    - Unified service combining recording and transcription
    - Supports batch and streaming recording modes
    - Direct OpenAI Whisper API integration
    - Real-time volume metering
    - Event-based architecture for UI updates

2. **speechConfig** (`src/services/speech/speechConfig.ts`)
    - Platform-specific FFmpeg configurations
    - Supported language definitions
    - Error messages and installation instructions

## Technical Specifications

### Audio Format (Matches Cline Implementation)

- **Container**: WebM (auto-detected from `.webm` extension)
- **Codec**: Opus (libopus)
- **Sample Rate**: 16kHz
- **Channels**: Mono (1 channel)
- **Bitrate**: 32kbps
- **Application**: VoIP optimized

### FFmpeg Configuration

**Critical**: No explicit format flag (`-f`) is used. FFmpeg automatically infers the container format from the `.webm` file extension. This matches Cline's working implementation exactly.

**Platform Configurations:**

```typescript
// macOS
;[
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
][
	// Linux
	("-f",
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
	outputFile)
][
	// Windows
	("-f",
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
	outputFile)
]
```

### Recording Modes

**Batch Mode:**

- Single file recording: `recording-${timestamp}.webm`
- Records until user stops
- Transcribes entire file at once

**Streaming Mode:**

- Segmented recording: `chunk_%03d.webm`
- 3-second chunks with 1-second overlap
- Progressive transcription every 2 seconds
- Word-level deduplication

## API Integration

### OpenAI Whisper API

- Direct API calls using user's OpenAI API key
- Auto-detects key from provider settings
- File upload via multipart/form-data
- **Format conversion**: WebM chunks are converted to MP3 before upload for better API compatibility
- OpenAI's API is strict about WebM validation, MP3 is more reliable

### Key Detection

The service automatically finds OpenAI API keys from:

1. `openai-native` provider
2. `openai` provider
3. Other OpenAI-compatible providers

## Real-Time Volume Metering

### Overview

Real-time audio level monitoring using FFmpeg's `astats` filter provides live feedback during recording.

### Implementation

- **Filter Graph**: `asplit=2[aout][am];[am]astats=metadata=1:reset=0.05,ametadata=print:key=lavfi.astats`
- **Update Rate**: ~20 samples/second
- **Output**: RMS and Peak levels in dB, normalized to 0-1 linear scale

### VolumeSample Interface

```typescript
interface VolumeSample {
	rmsDb: number // RMS level in dB (e.g., -22.4)
	peakDb: number // Peak level in dB (e.g., -3.1)
	linear: number // Normalized 0..1 value for UI
	at: number // Milliseconds since recording start
}
```

### Usage

```typescript
const speech = SpeechService.getInstance()

speech.on("volumeUpdate", (sample: VolumeSample) => {
	// sample.linear is 0..1 → perfect for UI animations
	updateVolumeVisualizer(sample.linear)
})

await speech.startStreamingRecording()
```

## UI Integration

### ClineProvider Integration

```typescript
// Message handlers
handleStartStreamingSpeech() // Starts streaming recording
handleStopStreamingSpeech() // Stops and returns final text
```

### UI Components

- **MicrophoneButton**: Red pulsing animation during recording
- **VolumeVisualizer**: Real-time audio level display
- **ChatTextArea**: Progressive text updates in placeholder

## State Management

### States

- `IDLE`: Not recording
- `RECORDING`: Active recording in progress
- `TRANSCRIBING`: Processing audio (batch mode only)

### Events

- `volumeUpdate`: Real-time volume samples
- `progressiveUpdate`: Streaming transcription updates
- `streamingError`: Error during streaming

## Configuration

```typescript
const DEFAULT_SETTINGS = {
	language: "en",
	maxRecordingDuration: 300, // 5 minutes
	chunkDuration: 3, // seconds
	overlapDuration: 1, // seconds
}
```

## Dependencies

- **FFmpeg**: Must be installed separately
    - macOS: `brew install ffmpeg`
    - Linux: `sudo apt-get install ffmpeg`
    - Windows: `winget install Gyan.FFmpeg`
- **OpenAI API Key**: From user's provider settings
- **Node.js**: v20.18.1

## Critical Implementation Notes

1. **File Extension**: Always use `.webm` (not `.ogg`)
2. **No Format Flag**: Never use `-f webm` or `-f ogg` - let FFmpeg infer from extension
3. **MIME Type**: Use `audio/webm` when uploading to OpenAI
4. **Matches Cline**: Configuration exactly matches Cline's working implementation

## Testing

Tests located in `src/services/speech/__tests__/`:

- `SpeechService.volume.spec.ts` - Volume metering tests (9 tests passing)
