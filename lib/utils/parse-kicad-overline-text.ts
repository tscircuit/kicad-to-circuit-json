export type KicadTextPart = { text: string; is_overlined?: boolean }

const appendPart = (
  parts: KicadTextPart[],
  text: string,
  isOverlined: boolean,
) => {
  if (!text) return
  const previous = parts.at(-1)
  if (previous && Boolean(previous.is_overlined) === isOverlined) {
    previous.text += text
    return
  }
  parts.push(isOverlined ? { text, is_overlined: true } : { text })
}

/** Parse KiCad's current ~{text} and legacy ~text~ overline markup. */
export const parseKicadOverlineText = (value: string): KicadTextPart[] => {
  const parts: KicadTextPart[] = []
  let buffer = ""
  let legacyOverline = false

  const flush = () => {
    appendPart(parts, buffer, legacyOverline)
    buffer = ""
  }

  for (let index = 0; index < value.length; ) {
    if (value.startsWith("~{", index)) {
      const closeIndex = value.indexOf("}", index + 2)
      if (closeIndex !== -1) {
        flush()
        appendPart(parts, value.slice(index + 2, closeIndex), true)
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
  return parts
}

export const getCircuitJsonPinLabel = (value: string) => {
  const textParts = parseKicadOverlineText(value)
  const text = textParts.map((part) => part.text).join("")
  const hasOverline = textParts.some((part) => part.is_overlined)
  const isFullyOverlined =
    textParts.length > 0 && textParts.every((part) => part.is_overlined)

  return {
    text,
    displayText: isFullyOverlined ? `N_${text}` : text,
    textParts: hasOverline ? textParts : undefined,
  }
}
