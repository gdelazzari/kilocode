# Speech Service Implementation Plan

## Phase 1: Module Extraction

### 1. AudioConverter Module (`src/services/speech/AudioConverter.ts`)

**Purpose**: Handle WebM to MP3 conversion using FFmpeg

**Key Methods**:

- `convertToMp3(webmPath: string): Promise<string>` - Convert WebM to MP3
- `cleanup(mp3Path: string): Promise<void>` - Clean up temporary MP3 files

**Features**:

- Proper error handling with stderr capture
- Automatic cleanup of temporary files
- Optimized conversion settings (16kHz mono, 32kbps)

### 2. TranscriptionClient Module (`src/services/speech/TranscriptionClient.ts`)

**Purpose**: Handle OpenAI Whisper API communication

**Key Methods**:

- `transcribe(filePath: string, language?: string): Promise<string>` - Transcribe audio file
- `getApiKey(): string | null` - Get OpenAI API key from context
- `getBaseUrl(): string` - Get OpenAI base URL

**Features**:

- Automatic API key detection from multiple providers
- Proper error handling for API failures
- Support for different audio formats

### 3. ChunkProcessor Module (`src/services/speech/ChunkProcessor.ts`)

**Purpose**: Handle chunk file detection and processing coordination

**Key Methods**:

- `startWatching(directory: string): void` - Start watching for chunks
- `stopWatching(): void` - Stop watching
- `processChunk(chunkPath: string): Promise<string>` - Process single chunk

**Events**:

- `chunkReady` - Emitted when chunk is ready for processing
- `chunkProcessed` - Emitted when chunk processing is complete
- `error` - Emitted on processing errors

### 4. StreamingManager Module (`src/services/speech/StreamingManager.ts`)

**Purpose**: Handle text deduplication and streaming state

**Key Methods**:

- `addChunkText(text: string): string` - Add chunk text with deduplication
- `getSessionText(): string` - Get current session text
- `reset(): void` - Reset session state

**Features**:

- Word-level deduplication between chunks
- Session text accumulation
- Progressive update events

## Phase 2: Event-Driven Architecture

### FFmpeg Segment Completion Detection

Instead of polling, use FFmpeg's built-in notifications:

```bash
ffmpeg -f avfoundation -i :default \
  -c:a libopus -b:a 32k -application voip -ar 16000 -ac 1 \
  -f segment -segment_time 3 -reset_timestamps 1 \
  -segment_list /tmp/segments.txt -segment_list_flags +live \
  /tmp/chunk_%03d.webm
```

**Key Changes**:

- Add `-segment_list` to track completed segments
- Parse FFmpeg stderr for "Opening/Closing" messages
- Only process chunks after "Closing" message

### Event Flow

```
1. AudioRecorder starts FFmpeg with segment completion logging
2. ChunkProcessor watches FFmpeg stderr for completion events
3. On "Closing chunk_001.webm" → emit chunkReady event
4. AudioConverter converts WebM → MP3
5. TranscriptionClient transcribes MP3
6. StreamingManager deduplicates and emits progressive updates
```

## Phase 3: SpeechService Refactor

Transform SpeechService from monolithic to orchestrator:

**New Structure**:

```typescript
export class SpeechService extends EventEmitter {
	private audioConverter: AudioConverter
	private transcriptionClient: TranscriptionClient
	private chunkProcessor: ChunkProcessor
	private streamingManager: StreamingManager

	// Orchestrate the modules instead of doing everything
}
```

**Benefits**:

- Single responsibility principle
- Easier testing and debugging
- Better error isolation
- Cleaner code organization

## Implementation Order

1. **Extract AudioConverter** - Self-contained, easy to test
2. **Extract TranscriptionClient** - Independent API client
3. **Extract ChunkProcessor** - Core event-driven logic
4. **Extract StreamingManager** - Text processing logic
5. **Refactor SpeechService** - Orchestration layer
6. **Add FFmpeg event parsing** - Replace polling
7. **Add comprehensive error handling** - Robust operation
8. **Write tests** - Ensure reliability

This approach eliminates race conditions and makes the system much more reliable and maintainable.
