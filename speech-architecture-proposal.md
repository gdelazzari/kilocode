# Speech Service Architecture Redesign

## Core Problem

Current implementation polls for chunk files and tries to process them while FFmpeg is still writing, causing race conditions and conversion failures.

## Proposed Solution: Event-Driven Architecture

### 1. FFmpeg Segment Completion Detection

Instead of polling, use FFmpeg's built-in segment completion callbacks:

- Use `-segment_list` to get notified when segments are complete
- Use `-segment_list_type csv` for structured output
- Parse FFmpeg stderr for segment completion messages

### 2. Modular Components

```
SpeechService (Orchestrator)
├── AudioRecorder (FFmpeg management)
├── ChunkProcessor (File watching & processing)
├── AudioConverter (WebM → MP3)
├── TranscriptionClient (OpenAI API)
└── StreamingManager (Text deduplication & events)
```

### 3. Event Flow

```
1. AudioRecorder starts FFmpeg with segment completion logging
2. ChunkProcessor watches for completion events (not file polling)
3. When chunk complete → AudioConverter converts to MP3
4. TranscriptionClient transcribes MP3
5. StreamingManager deduplicates and emits progressive updates
```

### 4. Key Improvements

**Reliable Chunk Detection:**

- Use FFmpeg's `-segment_list_flags +live` for real-time segment notifications
- Parse stderr for "Opening 'chunk_001.webm' for writing" and "Closing 'chunk_001.webm'" messages
- Only process chunks after "Closing" message

**Better Error Handling:**

- Separate concerns: recording errors vs transcription errors
- Retry logic for network failures
- Graceful degradation if conversion fails

**Performance:**

- No arbitrary waits or polling
- Parallel processing of completed chunks
- Efficient memory usage

## Implementation Strategy

1. **Phase 1**: Extract current functionality into modules (types, converter, client)
2. **Phase 2**: Replace polling with FFmpeg event parsing
3. **Phase 3**: Add proper error handling and retry logic
4. **Phase 4**: Optimize for performance and reliability

This eliminates race conditions and makes the system much more reliable.
