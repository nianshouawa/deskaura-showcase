import { describe, expect, it } from 'vitest'
import { encodeVoiceWav, voiceCaptureConstraints } from './voiceRecording'
describe('portable model ASR recording', () => {
  it('preserves quiet speech without disabling echo cancellation or gain control', () => {
    expect(voiceCaptureConstraints()).toEqual({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true,
    } })
  })
  it('writes mono 16k PCM WAV and clamps samples', async () => {
    const blob = encodeVoiceWav([new Float32Array([2, 2, 2, -2, -2, -2])], 48000)
    const buffer = await blob.arrayBuffer(), view = new DataView(buffer)
    expect(new TextDecoder().decode(buffer.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(buffer.slice(8, 12))).toBe('WAVE')
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(40, true)).toBe(4)
    expect(view.getInt16(44, true)).toBe(32767)
    expect(view.getInt16(46, true)).toBe(-32768)
  })
})
