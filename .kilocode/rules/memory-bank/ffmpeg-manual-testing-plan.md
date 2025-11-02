# FFmpeg Manual Testing Plan for Speech Service

## Objective

Verify FFmpeg segmented recording behavior step-by-step at the command line to understand exactly when chunks are created, written, and closed. This will inform the correct implementation in SpeechService.

## Prerequisites

- FFmpeg installed and available in PATH
- Terminal access
- Microphone permission granted

## Test 1: Basic Segmented Recording

### Command

```bash
# Create test directory
mkdir -p /tmp/ffmpeg-test-$(date +%s)
cd /tmp/ffmpeg-test-*

# Start segmented recording (3-second chunks)
ffmpeg -f avfoundation -i ":default" \
  -c:a libopus -b:a 32k -application voip -ar 16000 -ac 1 \
  -f segment -segment_time 3 -reset_timestamps 1 \
  chunk_%03d.webm
```

### What to Observe

1. **Chunk Creation**: When does `chunk_000.webm` appear in the directory?
2. **File Size Growth**: Watch file size with `ls -lh` in another terminal
3. **Chunk Transitions**: When does `chunk_001.webm` appear?
4. **FFmpeg stderr Output**: What messages appear when chunks are created/closed?

### Expected Behavior

- Chunks should appear immediately when created
- File size should grow as audio is recorded
- New chunk should appear every 3 seconds
- FFmpeg should output messages about segment operations

### Verification Steps

```bash
# In another terminal, watch the directory
watch -n 0.5 'ls -lh chunk_*.webm 2>/dev/null'

# After 10 seconds, stop FFmpeg (Ctrl+C)
# Then check what was created
ls -lh chunk_*.webm
```

### Record Observations

- [ ] Time when first chunk appeared: ****\_\_\_****
- [ ] Time when second chunk appeared: ****\_\_\_****
- [ ] File sizes when recording stopped: ****\_\_\_****
- [ ] FFmpeg stderr messages: ****\_\_\_****

---

## Test 2: Capture FFmpeg stderr Output

### Command

```bash
# Create test directory
mkdir -p /tmp/ffmpeg-stderr-test-$(date +%s)
cd /tmp/ffmpeg-stderr-test-*

# Record with stderr captured to file
ffmpeg -f avfoundation -i ":default" \
  -c:a libopus -b:a 32k -application voip -ar 16000 -ac 1 \
  -f segment -segment_time 3 -reset_timestamps 1 \
  chunk_%03d.webm \
  2> ffmpeg_stderr.log &

# Get the PID
FFMPEG_PID=$!
echo "FFmpeg PID: $FFMPEG_PID"

# Let it run for 10 seconds
sleep 10

# Stop it
kill -SIGTERM $FFMPEG_PID
wait $FFMPEG_PID 2>/dev/null

# Examine the stderr output
cat ffmpeg_stderr.log
```

### What to Look For in stderr

1. **Opening messages**: `Opening 'chunk_XXX.webm' for writing`
2. **Closing messages**: `Closing 'chunk_XXX.webm'`
3. **Segment messages**: `[segment @ ...] segment:'chunk_XXX.webm' ... ended`
4. **Timing information**: When do these messages appear relative to chunk creation?

### Verification Steps

```bash
# Search for specific patterns
grep -i "opening" ffmpeg_stderr.log
grep -i "closing" ffmpeg_stderr.log
grep -i "segment" ffmpeg_stderr.log
```

### Record Observations

- [ ] "Opening" messages found: YES / NO
- [ ] "Closing" messages found: YES / NO
- [ ] "Segment" messages found: YES / NO
- [ ] Pattern of messages: ****\_\_\_****

---

## Test 3: Real-time stderr Monitoring

### Command

```bash
# Create test directory
mkdir -p /tmp/ffmpeg-realtime-test-$(date +%s)
cd /tmp/ffmpeg-realtime-test-*

# Start FFmpeg and pipe stderr to a monitoring script
ffmpeg -f avfoundation -i ":default" \
  -c:a libopus -b:a 32k -application voip -ar 16000 -ac 1 \
  -f segment -segment_time 3 -reset_timestamps 1 \
  chunk_%03d.webm \
  2>&1 | while IFS= read -r line; do
    echo "[$(date +%H:%M:%S.%3N)] $line"

    # Check for chunk events
    if echo "$line" | grep -qi "opening.*chunk"; then
      echo ">>> CHUNK OPENING DETECTED <<<"
    fi

    if echo "$line" | grep -qi "closing.*chunk"; then
      echo ">>> CHUNK CLOSING DETECTED <<<"
    fi

    if echo "$line" | grep -qi "segment.*ended"; then
      echo ">>> SEGMENT ENDED DETECTED <<<"
    fi
  done
```

### What to Observe

1. **Timing**: Exact timestamps when events occur
2. **Order**: Do "Opening" messages come before "Closing"?
3. **Reliability**: Are these messages consistent for every chunk?
4. **Delay**: How long between "Opening" and "Closing"?

### Verification Steps

- Let it run for 15 seconds (should create 5 chunks)
- Press Ctrl+C to stop
- Review the timestamped output

### Record Observations

- [ ] Consistent "Opening" messages: YES / NO
- [ ] Consistent "Closing" messages: YES / NO
- [ ] Time between Opening and Closing: ****\_\_\_****
- [ ] Messages appear for every chunk: YES / NO

---

## Test 4: File Accessibility Test

### Command

```bash
# Create test directory
mkdir -p /tmp/ffmpeg-access-test-$(date +%s)
cd /tmp/ffmpeg-access-test-*

# Start FFmpeg in background
ffmpeg -f avfoundation -i ":default" \
  -c:a libopus -b:a 32k -application voip -ar 16000 -ac 1 \
  -f segment -segment_time 3 -reset_timestamps 1 \
  chunk_%03d.webm \
  2> ffmpeg.log &

FFMPEG_PID=$!

# Monitor and try to read chunks as they're created
for i in {1..10}; do
  sleep 1
  echo "=== Second $i ==="

  # List chunks
  ls -lh chunk_*.webm 2>/dev/null || echo "No chunks yet"

  # Try to read the first chunk if it exists
  if [ -f chunk_000.webm ]; then
    # Check if file is still being written (lsof shows open files)
    if command -v lsof >/dev/null; then
      lsof chunk_000.webm 2>/dev/null && echo "chunk_000.webm is OPEN by FFmpeg" || echo "chunk_000.webm is CLOSED"
    fi

    # Try to read file size
    stat -f%z chunk_000.webm 2>/dev/null || stat -c%s chunk_000.webm 2>/dev/null
  fi
done

# Stop FFmpeg
kill -SIGTERM $FFMPEG_PID
wait $FFMPEG_PID 2>/dev/null

# Check final state
echo "=== Final State ==="
ls -lh chunk_*.webm
```

### What to Observe

1. **File Locking**: Is the file locked while FFmpeg writes to it?
2. **Size Changes**: Does file size change while FFmpeg has it open?
3. **Accessibility**: Can we read the file while FFmpeg is writing?

### Record Observations

- [ ] Files locked while being written: YES / NO
- [ ] File size changes detected: YES / NO
- [ ] Can read file while FFmpeg writing: YES / NO

---

## Test 5: Chunk Processing Simulation

### Command

```bash
# Create test directory
mkdir -p /tmp/ffmpeg-process-test-$(date +%s)
cd /tmp/ffmpeg-process-test-*

# Create a processing script
cat > process_chunk.sh << 'EOF'
#!/bin/bash
CHUNK=$1
echo "[$(date +%H:%M:%S)] Processing: $CHUNK"

# Try to convert to MP3 (simulating our AudioConverter)
ffmpeg -i "$CHUNK" -vn -ar 16000 -ac 1 -b:a 32k -f mp3 "${CHUNK%.webm}.mp3" -y 2>&1 | grep -i error || echo "Conversion successful"

# Check result
if [ -f "${CHUNK%.webm}.mp3" ]; then
  echo "[$(date +%H:%M:%S)] ✓ MP3 created: ${CHUNK%.webm}.mp3"
  ls -lh "${CHUNK%.webm}.mp3"
else
  echo "[$(date +%H:%M:%S)] ✗ MP3 creation failed"
fi
EOF

chmod +x process_chunk.sh

# Start FFmpeg with stderr monitoring
ffmpeg -f avfoundation -i ":default" \
  -c:a libopus -b:a 32k -application voip -ar 16000 -ac 1 \
  -f segment -segment_time 3 -reset_timestamps 1 \
  chunk_%03d.webm \
  2>&1 | while IFS= read -r line; do
    echo "$line"

    # When we detect a chunk is closed, process it
    if echo "$line" | grep -qi "closing.*'chunk_\([0-9]*\)\.webm'"; then
      CHUNK=$(echo "$line" | grep -oE "chunk_[0-9]{3}\.webm")
      if [ -n "$CHUNK" ]; then
        echo ">>> Detected closed chunk: $CHUNK, processing..."
        ./process_chunk.sh "$CHUNK" &
      fi
    fi
  done
```

### What to Observe

1. **Processing Timing**: Can we successfully process chunks immediately after "Closing" message?
2. **Conversion Success**: Does WebM → MP3 conversion work reliably?
3. **Race Conditions**: Do we ever try to process a chunk that's not ready?

### Verification Steps

- Let it run for 15 seconds
- Press Ctrl+C to stop
- Check if all chunks were processed successfully
- Verify MP3 files were created

### Record Observations

- [ ] All chunks processed successfully: YES / NO
- [ ] Any conversion errors: YES / NO
- [ ] Race conditions detected: YES / NO
- [ ] Processing delay after "Closing": ****\_\_\_****

---

## Test 6: Verify Chunk Completeness

### Command

```bash
# Create test directory
mkdir -p /tmp/ffmpeg-complete-test-$(date +%s)
cd /tmp/ffmpeg-complete-test-*

# Record for 10 seconds
timeout 10 ffmpeg -f avfoundation -i ":default" \
  -c:a libopus -b:a 32k -application voip -ar 16000 -ac 1 \
  -f segment -segment_time 3 -reset_timestamps 1 \
  chunk_%03d.webm \
  2> ffmpeg.log

# Verify each chunk is valid
for chunk in chunk_*.webm; do
  echo "=== Verifying $chunk ==="

  # Check file size
  size=$(stat -f%z "$chunk" 2>/dev/null || stat -c%s "$chunk" 2>/dev/null)
  echo "Size: $size bytes"

  # Try to get duration
  ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$chunk" 2>/dev/null || echo "Could not read duration"

  # Try to convert (validates file integrity)
  ffmpeg -v error -i "$chunk" -f null - 2>&1 && echo "✓ File is valid" || echo "✗ File is corrupted"
done
```

### What to Observe

1. **File Validity**: Are all chunks valid WebM files?
2. **Duration**: Do chunks have the expected ~3 second duration?
3. **Corruption**: Any signs of incomplete or corrupted files?

### Record Observations

- [ ] All chunks valid: YES / NO
- [ ] Expected durations: YES / NO
- [ ] Any corruption detected: YES / NO

---

## Summary & Conclusions

After completing all tests, answer these key questions:

### 1. Chunk Detection Strategy

**Question**: What is the most reliable way to detect when a chunk is ready to process?

**Options**:

- [ ] A) Poll directory for new files
- [ ] B) Watch for "Closing" message in stderr
- [ ] C) Watch for "segment ended" message in stderr
- [ ] D) Use file size stability checks
- [ ] E) Combination of: ****\_\_\_****

**Chosen Strategy**: ****\_\_\_****

**Reasoning**: ****\_\_\_****

### 2. Timing Characteristics

**Question**: What is the typical delay between chunk creation and readiness?

- Chunk appears in directory: ****\_\_\_****
- Chunk is fully written: ****\_\_\_****
- "Closing" message appears: ****\_\_\_****
- Safe to process after: ****\_\_\_****

### 3. Error Conditions

**Question**: What error conditions did you observe?

- [ ] Files created but empty
- [ ] Files locked by FFmpeg
- [ ] Conversion failures
- [ ] Missing "Closing" messages
- [ ] Other: ****\_\_\_****

### 4. Implementation Recommendations

Based on test results, the ChunkProcessor should:

1. **Primary Detection Method**: ****\_\_\_****
2. **Fallback Detection Method**: ****\_\_\_****
3. **Safety Delay (if any)**: ****\_\_\_****
4. **Error Handling Strategy**: ****\_\_\_****

### 5. Code Changes Needed

List specific changes needed in:

**ChunkProcessor.ts**:

- [ ] Change 1: ****\_\_\_****
- [ ] Change 2: ****\_\_\_****

**SpeechService.ts**:

- [ ] Change 1: ****\_\_\_****
- [ ] Change 2: ****\_\_\_****

---

## Next Steps

After completing manual testing:

1. Document all observations in this file
2. Update ChunkProcessor implementation based on findings
3. Update SpeechService if needed
4. Create automated tests that replicate these scenarios
5. Verify the implementation works end-to-end
