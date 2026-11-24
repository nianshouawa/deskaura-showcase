/** Passive pages keep long replies readable without adding bubble interactions. */
export function bubblePages(value: string, maximum = 110): string[] {
  const characters = Array.from(value.trim())
  const pages: string[] = []
  while (characters.length) {
    let end = Math.min(maximum, characters.length)
    if (end < characters.length) {
      for (let i = end - 1; i >= maximum * .55; i--) {
        if (/[。！？!?；;\n]/.test(characters[i])) { end = i + 1; break }
      }
    }
    pages.push(characters.splice(0, end).join(''))
  }
  return pages
}

/** Follow the growing final page instead of restarting page one on every token. */
export function streamingBubbleText(value: string): string {
  const pages = bubblePages(value)
  const content = pages[pages.length - 1] || ''
  return content + (pages.length > 1 ? `\n${pages.length} / ${pages.length}` : '')
}
