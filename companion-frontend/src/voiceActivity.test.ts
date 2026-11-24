import { describe, expect, it } from 'vitest'
import { likelyPlaybackEcho, usefulTranscript, VoiceActivityGate } from './voiceActivity'
const rate = 16000
const voice = () => Float32Array.from({ length: 2048 }, (_, i) => .06 * Math.sin(2 * Math.PI * i * 170 / rate) + .04 * Math.sin(2 * Math.PI * i * 340 / rate) + .02 * Math.sin(2 * Math.PI * i * 510 / rate))
describe('local voice gate', () => {
  it('rejects DC, steady hum, white-noise-like hiss and short clicks', () => {
    const gate = new VoiceActivityGate()
    const steady = Float32Array.from({ length: 2048 }, (_, i) => .1 * Math.sin(2 * Math.PI * i * 100 / rate))
    const hiss = Float32Array.from({ length: 2048 }, (_, i) => i % 2 ? -.08 : .08)
    for (let i = 0; i < 10; i++) for (const samples of [new Float32Array(2048).fill(.1), steady, hiss]) expect(gate.frame(samples, rate).speech).toBe(false)
    expect(new VoiceActivityGate().frame(voice(), rate).speech).toBe(false)
  })
  it('requires sustained speech and more evidence during playback', () => {
    const gate = new VoiceActivityGate()
    for (let i = 0; i < 3; i++) expect(gate.frame(voice(), rate).speech).toBe(false)
    expect(gate.frame(voice(), rate).speech).toBe(true)
    gate.reset()
    for (let i = 0; i < 4; i++) expect(gate.frame(voice(), rate, true).speech).toBe(false)
    expect(gate.frame(voice(), rate, true).speech).toBe(true)
  })
  it('ignores faint speech-shaped background and separated bursts', () => {
    const gate = new VoiceActivityGate()
    const faint = Float32Array.from(voice(), value => value * .1)
    for (let i = 0; i < 20; i++) expect(gate.frame(faint, rate).speech).toBe(false)
    for (let i = 0; i < 10; i++) {
      expect(gate.frame(voice(), rate).speech).toBe(false)
      gate.frame(new Float32Array(2048), rate)
      gate.frame(new Float32Array(2048), rate)
    }
  })
  it('hears sustained soft speech without learning it as the noise floor', () => {
    const quiet = Float32Array.from(voice(), value => value * .13)
    const gate = new VoiceActivityGate()
    for (let i = 0; i < 12; i++) gate.frame(quiet, rate)
    expect(gate.frame(quiet, rate).speech).toBe(true)
    gate.reset()
    // Quiet voice can be captured while listening, but is not enough to
    // interrupt speaker playback without the stronger SNR evidence.
    for (let i = 0; i < 12; i++) expect(gate.frame(quiet, rate, true).speech).toBe(false)
    const softPlaybackSpeech = Float32Array.from(voice(), value => value * .25)
    for (let i = 0; i < 5; i++) gate.frame(softPlaybackSpeech, rate, true)
    expect(gate.frame(softPlaybackSpeech, rate, true).speech).toBe(true)
  })
  it('rejects quiet background hum and invalid frames without triggering speech', () => {
    const gate = new VoiceActivityGate()
    const hum = Float32Array.from({ length: 2048 }, (_, i) => .009 * Math.sin(2 * Math.PI * i * 100 / rate))
    for (let i = 0; i < 30; i++) expect(gate.frame(hum, rate).speech).toBe(false)
    expect(gate.frame(new Float32Array(), rate).speech).toBe(false)
    expect(gate.frame(voice(), 0).speech).toBe(false)
  })
  it('filters non-speech labels without losing short real utterances', () => {
    expect(usefulTranscript('[noise]')).toBe(false); expect(usefulTranscript('背景噪声')).toBe(false)
    expect(usefulTranscript('嗯')).toBe(true); expect(usefulTranscript('谢谢')).toBe(true)
    expect(likelyPlaybackEcho('这是模型正在说的话', '好的，这是模型正在说的话。')).toBe(true)
    expect(likelyPlaybackEcho('等一下', '等一下，我来查看。')).toBe(false)
  })
})
