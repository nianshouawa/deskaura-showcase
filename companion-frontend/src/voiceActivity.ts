/** Adaptive local gate, after the device's echo cancellation/gain control.
 * This is not speaker identification: it rejects silence, steady hum, isolated
 * clicks and high-frequency noise, but cannot distinguish a nearby television. */
export class VoiceActivityGate {
  private noise = .0015
  private sustained = 0
  reset() { this.noise = .0015; this.sustained = 0 }
  frame(samples: Float32Array, rate: number, outputActive = false) {
    if (!samples.length || !Number.isFinite(rate) || rate <= 0) {
      return { rms: 0, voice: false, sustained: this.sustained, speech: false }
    }
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
    let energy = 0, peak = 0, crossings = 0, previous = 0
    for (let i = 0; i < samples.length; i++) {
      const value = samples[i]! - mean
      energy += value * value; peak = Math.max(peak, Math.abs(value))
      if (i && Math.sign(value) !== Math.sign(previous)) crossings++
      previous = value
    }
    const rms = Math.sqrt(energy / samples.length), crest = peak / Math.max(rms, 1e-7)
    const crossingRate = crossings / samples.length
    // Quiet near-field speech must not need the old fixed .012/.025 RMS.
    // Playback still needs more SNR and a longer utterance, while AEC and the
    // recognized-text echo check provide separate safeguards.
    const threshold = Math.max(outputActive ? .012 : .006, this.noise * (outputActive ? 3.8 : 2.8))
    const speechShape = crest > 1.55 && crest < 12 && crossingRate > .006 && crossingRate < .34
    const voice = rms > threshold && speechShape
    // Do not learn plausible but quiet speech as noise and progressively mute it.
    if (!speechShape) this.noise = Math.min(.012, this.noise * .985 + Math.min(rms, .02) * .015)
    this.sustained = voice ? this.sustained + samples.length / rate : Math.max(0, this.sustained - samples.length / rate * 1.5)
    return { rms, voice, sustained: this.sustained, speech: this.sustained >= (outputActive ? .55 : .42) }
  }
}

export function usefulTranscript(value: string) {
  const text = value.trim()
  if (!/[\p{L}\p{N}]/u.test(text)) return false
  return !/^(?:\[?(?:noise|music|silence|inaudible|blank_audio)\]?|无(?:有效)?(?:语音|声音)|(?:背景)?(?:噪音|噪声|音乐)|字幕(?:由|提供)|感谢观看|请不吝点赞)/i.test(text)
}

export function likelyPlaybackEcho(value: string, output: string) {
  const normalized = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const input = normalized(value), reply = normalized(output)
  return input.length >= 6 && reply.includes(input)
}
