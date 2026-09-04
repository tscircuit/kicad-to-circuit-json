export type KicadTextRun = { text: string; overline?: boolean }

const appendRun = (runs: KicadTextRun[], text: string, overline: boolean) => {
  if (!text) return
  const previous = runs.at(-1)
  if (previous && Boolean(previous.overline) === overline) {
    previous.text += text
    return
  }
  runs.push(overline ? { text, overline: true } : { text })
}

/** Parse KiCad's current ~{text} and legacy ~text~ overline markup. */
export const parseKicadOverlineText = (value: string): KicadTextRun[] => {
  const runs: KicadTextRun[] = []
  let buffer = ""
  let legacyOverline = false

  const flush = () => {
    appendRun(runs, buffer, legacyOverline)
    buffer = ""
  }

  for (let index = 0; index < value.length; ) {
    if (value.startsWith("~{", index)) {
      const closeIndex = value.indexOf("}", index + 2)
      if (closeIndex !== -1) {
        flush()
        appendRun(runs, value.slice(index + 2, closeIndex), true)
        index = closeIndex + 1
        continue
      }
    }

    if (value[index] === "~") {
      flush()
      legacyOverline = !legacyOverline
      index += 1
      continue
    }

    buffer += value[index]
    index += 1
  }

  flush()
  return runs
}

export const getCircuitJsonPinLabel = (value: string) => {
  const textRuns = parseKicadOverlineText(value)
  const text = textRuns.map((run) => run.text).join("")
  const hasOverline = textRuns.some((run) => run.overline)
  const isFullyOverlined =
    textRuns.length > 0 && textRuns.every((run) => run.overline)

  return {
    text,
    displayText: isFullyOverlined ? `N_${text}` : text,
    textRuns: hasOverline ? textRuns : undefined,
  }
}
