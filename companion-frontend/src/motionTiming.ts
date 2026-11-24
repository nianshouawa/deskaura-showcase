/** Only an explicitly selected local gesture may be retimed by the chat model.
 * Cloud clips keep their own native predicted duration, reply loops use audio.
 */
export function motionPlaybackTiming(sourceDuration: number, requested: number, durationSource?: string) {
  const source = Math.max(.01, sourceDuration)
  const local = durationSource === 'local_selection' && Number.isFinite(requested) && requested > 0
  const duration = local ? Math.max(.5, Math.min(20, requested)) : source
  return { duration, sampleScale: source / duration }
}
