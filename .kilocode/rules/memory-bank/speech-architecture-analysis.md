# Speech Service Architecture Analysis

## Executive Summary

The current [`SpeechService.ts`](../../../src/services/speech/SpeechService.ts) implementation (917 lines) suffers from critical race conditions in streaming mode, causing FFmpeg exit code 183 errors. The root cause is **polling-based chunk detection** that reads files while FFmpeg is still writing them.

## Critical Issues Identified

### 1. Race Condition in Chunk Processing (Lines 687-732)

**Problem**: [`startChunkWatcher()`](../../../src/services/speech/SpeechService.ts:687) uses `setInterval()` to poll for chunk files every 2 seconds, but FFmpeg may still be writing to these files.

```typescript
// Current implementation - PROBLEMATIC
private startChunkWatcher(): void {
    const emitInterval = this.streamingConfig.chunkDurationSeconds - this.streamingConfig.overlapDurationSeconds
    this.chunkWatcher = setInterval(async () => {
        await this.checkForNewChunks()
    }, emitInterval * 1000)
}
```

**Why it fails**:

- FFmpeg creates chunk files immediately but writes data over time
- Polling detects files before FFmpeg closes them
- [`waitForFileStable()`](../../../src/services/speech/SpeechService.ts:818) uses arbitrary timeouts (2 seconds) instead of proper completion detection
- File size checks don't guarantee FFmpeg has released the file handle

### 2. Inefficient File Stability Detection (Lines 818-848)

**Problem**: [`waitForFileStable()`](../../../src/services/speech/SpeechService.ts:818) uses size-based polling with arbitrary timeouts.

```typescript
// Current implementation - UNRELIABLE
private async waitForFileStable(filePath: string, maxWaitMs = 2000): Promise<void> {
    // Polls file size every 100ms for up to 2 seconds
    // Assumes stable if size unchanged for 200ms
    // No guarantee FFmpeg has closed the file
}
```

**Why it fails**:

- FFmpeg may pause writing temporarily (size appears stable)
- 2-second timeout is arbitrary and may be too short
- No detection of FFmpeg's actual file closure
- Race condition: file may appear stable but FFmpeg still has it open

### 3. Monolithic Design

**Problem**: Single 917-line file handles:

- FFmpeg process management
- Audio recording (batch + streaming)
- WebM → MP3 conversion
- OpenAI Whisper API calls
- Text deduplication
- Volume metering
- State management

**Impact**:

- Hard to test individual components
- Error handling is scattered
- Difficult to maintain and debug
- No clear separation of concerns

### 4. Missing Event-Driven Architecture

**Problem**: No proper FFmpeg event parsing. The service doesn't listen to FFmpeg's stderr for segment completion events.

**What's needed**:

- Parse FFmpeg stderr for segment completion messages
- Only process chunks after FFmpeg explicitly closes them
- Use event-driven flow instead of polling

## Proposed Solution: Modular Event-Driven Architecture

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      SpeechService                          │
│                   (Orchestration Layer)                     │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│AudioConverter│    │ChunkProcessor│    │Transcription │
│              │    │              │    │   Client     │
│ WebM → MP3   │    │ FFmpeg Event │    │              │
│ Conversion   │    │   Parsing    │    │ OpenAI API   │
└──────────────┘    └──────────────┘    └──────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │ Streaming    │
                    │  Manager     │
                    │              │
                    │Deduplication │
                    └──────────────┘
```

### Module Breakdown

#### 1. AudioConverter (New)

**Responsibility**: WebM → MP3 conversion
**Location**: [`src/services/speech/AudioConverter.ts`](../../../src/services/speech/AudioConverter.ts)
**Interface**:

```typescript
class AudioConverter {
	async convertToMp3(webmPath: string): Promise<string>
	async convertBatch(webmPaths: string[]): Promise<string[]>
}
```

#### 2. TranscriptionClient (New)

**Responsibility**: OpenAI Whisper API communication
**Location**: `src/services/speech/TranscriptionClient.ts`
**Interface**:

```typescript
class TranscriptionClient {
	async transcribe(audioPath: string, options: TranscriptionOptions): Promise<string>
	async transcribeBatch(audioPaths: string[]): Promise<string[]>
}
```

#### 3. ChunkProcessor (New - CRITICAL)

**Responsibility**: Event-driven FFmpeg chunk detection
**Location**: `src/services/speech/ChunkProcessor.ts`
**Key Features**:

- Parse FFmpeg stderr for segment completion events
- Emit events when chunks are fully written and closed
- No polling - pure event-driven
- Proper error handling per chunk

**Interface**:

```typescript
class ChunkProcessor extends EventEmitter {
	// Events: 'chunkReady', 'chunkError', 'complete'
	startWatching(ffmpegProcess: ChildProcess, outputDir: string): void
	stopWatching(): void
}
```

**Implementation Strategy**:

```typescript
// Parse FFmpeg stderr for segment completion
ffmpegProcess.stderr.on("data", (data) => {
	const text = data.toString()

	// FFmpeg outputs: "Opening 'chunk_001.webm' for writing"
	// FFmpeg outputs: "Closing 'chunk_001.webm'"

	if (text.includes("Closing '")) {
		const match = text.match(/Closing '([^']+)'/)
		if (match) {
			const chunkPath = match[1]
			this.emit("chunkReady", chunkPath)
		}
	}
})
```

#### 4. StreamingManager (New)

**Responsibility**: Text deduplication and streaming state
**Location**: `src/services/speech/StreamingManager.ts`
**Interface**:

```typescript
class StreamingManager {
	addChunkText(chunkId: number, text: string): string
	getSessionText(): string
	reset(): void
}
```

#### 5. SpeechService (Refactored)

**Responsibility**: Orchestration only
**Reduced to ~300 lines**
**Delegates to**:

- AudioConverter for conversion
- TranscriptionClient for API calls
- ChunkProcessor for chunk detection
- StreamingManager for text handling

### Event Flow (Streaming Mode)

```
1. User starts recording
   └─> SpeechService.startStreamingRecording()
       └─> Spawn FFmpeg with segment output
       └─> ChunkProcessor.startWatching(ffmpegProcess)

2. FFmpeg writes chunk
   └─> FFmpeg stderr: "Opening 'chunk_001.webm'"
   └─> FFmpeg writes audio data
   └─> FFmpeg stderr: "Closing 'chunk_001.webm'"
       └─> ChunkProcessor emits 'chunkReady' event

3. ChunkProcessor 'chunkReady' event
   └─> SpeechService receives event
       └─> AudioConverter.convertToMp3(chunk_001.webm)
           └─> Returns chunk_001.mp3
       └─> TranscriptionClient.transcribe(chunk_001.mp3)
           └─> Returns transcribed text
       └─> StreamingManager.addChunkText(1, text)
           └─> Deduplicates with previous chunk
           └─> Returns deduplicated text
       └─> SpeechService emits 'progressiveUpdate' event

4. User stops recording
   └─> SpeechService.stopStreamingRecording()
       └─> Kill FFmpeg
       └─> ChunkProcessor.stopWatching()
       └─> Process any remaining chunks
       └─> Return final text
```

## Implementation Benefits

### 1. Eliminates Race Conditions

- No polling - chunks processed only after FFmpeg closes them
- FFmpeg stderr parsing provides definitive completion signal
- No arbitrary timeouts or file size checks

### 2. Improved Testability

- Each module can be unit tested independently
- Mock FFmpeg stderr output for ChunkProcessor tests
- Mock API responses for TranscriptionClient tests
- No need to spawn actual FFmpeg processes in tests

### 3. Better Error Handling

- Errors isolated to specific modules
- Failed chunk doesn't crash entire service
- Retry logic can be added per module
- Clear error propagation path

### 4. Maintainability

- Single Responsibility Principle
- Each module ~100-200 lines
- Clear interfaces between modules
- Easy to add features (e.g., different transcription providers)

### 5. Performance

- No wasted CPU on polling
- Chunks processed immediately when ready
- Parallel conversion/transcription possible
- Reduced latency in streaming mode

## Migration Strategy

### Phase 1: Create Module Interfaces

- [x] Create [`types.ts`](../../../src/services/speech/types.ts) with all interfaces
- [x] Create empty [`AudioConverter.ts`](../../../src/services/speech/AudioConverter.ts)
- [ ] Create empty `TranscriptionClient.ts`
- [ ] Create empty `ChunkProcessor.ts`
- [ ] Create empty `StreamingManager.ts`

### Phase 2: Implement Modules

- [ ] Implement AudioConverter (extract from [`SpeechService.ts:483-527`](../../../src/services/speech/SpeechService.ts:483))
- [ ] Implement TranscriptionClient (extract from [`SpeechService.ts:439-477`](../../../src/services/speech/SpeechService.ts:439))
- [ ] Implement ChunkProcessor (NEW - event-driven chunk detection)
- [ ] Implement StreamingManager (extract from [`SpeechService.ts:853-872`](../../../src/services/speech/SpeechService.ts:853))

### Phase 3: Refactor SpeechService

- [ ] Replace inline conversion with AudioConverter calls
- [ ] Replace inline transcription with TranscriptionClient calls
- [ ] Replace polling with ChunkProcessor events
- [ ] Replace inline deduplication with StreamingManager calls
- [ ] Remove all extracted code

### Phase 4: Testing

- [ ] Unit tests for each module
- [ ] Integration tests for full flow
- [ ] Test race condition scenarios
- [ ] Performance benchmarks

## Key Implementation Details

### FFmpeg Stderr Parsing

FFmpeg outputs segment information to stderr:

```
Opening 'chunk_000.webm' for writing
[segment @ 0x...] segment:'chunk_000.webm' starts with packet stream:0 pts:0
[segment @ 0x...] segment:'chunk_000.webm' count:0 ended
Closing 'chunk_000.webm'
Opening 'chunk_001.webm' for writing
```

**Critical patterns to detect**:

- `Opening '(.+)' for writing` - Chunk file created
- `Closing '(.+)'` - Chunk file closed and ready
- `segment:'(.+)' count:(\d+) ended` - Segment completed

### Volume Metering (Currently Disabled)

Lines 153-154, 290-292, 298-299 show volume metering is temporarily disabled. This should be re-enabled after fixing the core race condition.

**Current issue**: Volume meter filter may interfere with segment output format.

**Solution**: Use separate audio filter chain that doesn't affect segment output:

```typescript
// Split audio: one for output, one for volume analysis
"-filter_complex",
	"[0:a]asplit=2[out][vol];[vol]astats=metadata=1:reset=0.05[vol_out]",
	"-map",
	"[out]", // Main output for segments
	"-map",
	"[vol_out]",
	"-f",
	"null",
	"-" // Volume analysis to null
```

## Conclusion

The current implementation's core issue is **polling-based chunk detection** causing race conditions. The solution is an **event-driven architecture** that:

1. Parses FFmpeg stderr for definitive chunk completion signals
2. Processes chunks only after FFmpeg closes them
3. Separates concerns into testable, maintainable modules
4. Eliminates arbitrary timeouts and file size checks

This architecture will make the speech service reliable, maintainable, and performant.
