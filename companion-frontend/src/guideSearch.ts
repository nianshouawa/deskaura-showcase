import type { ObjectDirective } from 'vue'

type HighlightedText = { original: Text; inserted: Node[] }
const highlighted = new WeakMap<HTMLElement, HighlightedText[]>()

export function clearGuideHighlights(root: HTMLElement) {
  for (const { original, inserted } of highlighted.get(root) || []) {
    const first = inserted[0], parent = first?.parentNode
    if (parent) {
      parent.insertBefore(original, first!)
      inserted.forEach(node => { if (node.parentNode === parent) parent.removeChild(node) })
    }
  }
  highlighted.delete(root)
}

/** Restore the original text nodes before Vue updates their owning elements. */
export function highlightGuideMatches(root: HTMLElement, query: string) {
  clearGuideHighlights(root)
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
  if (!terms.length) return
  const expression = new RegExp(terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi')
  const document = root.ownerDocument
  const walker = document.createTreeWalker(root, 4)
  const originals: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text, parent = text.parentElement
    if (!parent || parent.closest('script,style,textarea,mark')) continue
    const section = parent.closest('section')
    if (section?.style.display === 'none') continue
    originals.push(text)
  }
  const records: HighlightedText[] = []
  for (const original of originals) {
    expression.lastIndex = 0
    const value = original.data, fragment = document.createDocumentFragment()
    let previous = 0, match: RegExpExecArray | null
    while ((match = expression.exec(value))) {
      if (match.index > previous) fragment.append(document.createTextNode(value.slice(previous, match.index)))
      const mark = document.createElement('mark')
      mark.className = 'guide-search-match'
      mark.textContent = match[0]
      fragment.append(mark)
      previous = match.index + match[0].length
    }
    if (!previous) continue
    if (previous < value.length) fragment.append(document.createTextNode(value.slice(previous)))
    const inserted = Array.from(fragment.childNodes)
    original.replaceWith(fragment)
    records.push({ original, inserted })
  }
  highlighted.set(root, records)
}

export const vHighlightSearch: ObjectDirective<HTMLElement, string> = {
  mounted: (element, binding) => highlightGuideMatches(element, binding.value),
  beforeUpdate: element => clearGuideHighlights(element),
  updated: (element, binding) => highlightGuideMatches(element, binding.value),
  beforeUnmount: element => clearGuideHighlights(element),
}
