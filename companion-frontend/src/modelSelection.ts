/** Preview selection never implies that the desktop model was applied. */
export function applicationButton(selected: string, applied: string, applying: string, ready: string) {
  if (applying === selected && selected) return { label: '应用中…', disabled: true }
  if (selected && selected === applied) return { label: '取消应用', disabled: !!applying }
  return { label: '应用', disabled: !selected || selected !== ready || !!applying }
}
