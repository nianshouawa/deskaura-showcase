/** Preserve soft speech; strong browser suppression can erase quiet syllables.
 * AEC, gain control and the local VAD/echo checks remain enabled separately. */
export function voiceCaptureConstraints(): MediaStreamConstraints {
  return { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true } }
}

/** Resample microphone float PCM to portable 16 kHz mono 16-bit WAV. */
export function encodeVoiceWav(chunks: Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((n, part) => n + part.length, 0)
  const source = new Float32Array(length)
  let offset = 0
  for (const part of chunks) { source.set(part, offset); offset += part.length }
  const rate = 16000, ratio = sampleRate / rate, size = Math.floor(length / ratio)
  const buffer = new ArrayBuffer(44 + size * 2), view = new DataView(buffer)
  const tag = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  tag(0, 'RIFF'); view.setUint32(4, 36 + size * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  tag(36, 'data'); view.setUint32(40, size * 2, true)
  // Average source samples rather than dropping samples (basic low-pass decimation).
  for (let i = 0; i < size; i++) {
    const begin = Math.floor(i * ratio), end = Math.min(length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = begin; j < end; j++) sum += source[j] || 0
    const value = Math.max(-1, Math.min(1, sum / Math.max(1, end - begin)))
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
