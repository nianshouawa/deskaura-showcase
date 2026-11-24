/** Calls interrupt immediately; ordinary chat can hold exactly one next message. */
export function messageDelivery(inCall: boolean, replyActive: boolean, hasPending: boolean): 'send' | 'interrupt' | 'queue' | 'full' {
  if (inCall) return replyActive ? 'interrupt' : 'send'
  if (hasPending) return 'full'
  return replyActive ? 'queue' : 'send'
}

/** The central call control replaces the waveform, not the microphone control. */
export function composerPresentation(inCall: boolean, replyActive: boolean, userSpeaking: boolean, recording: boolean): 'interrupt' | 'waveform' | 'text' {
  if (inCall && replyActive && !userSpeaking) return 'interrupt'
  return recording ? 'waveform' : 'text'
}
