export interface ParsedKicadTextPart {
  text: string
  is_overlined?: boolean
}

const appendPart = (
  parts: ParsedKicadTextPart[],
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

const findClosingBrace = (kicadText: string, openBraceIndex: number) => {
  let depth = 1
  for (let index = openBraceIndex + 1; index < kicadText.length; index += 1) {
    if (kicadText[index] === "{") depth += 1
    if (kicadText[index] !== "}") continue
    depth -= 1
    if (depth === 0) return index
  }
  return -1
}

const parseParts = (
  kicadText: string,
  forceOverline = false,
): ParsedKicadTextPart[] => {
  const parts: ParsedKicadTextPart[] = []
  let buffer = ""

  const flush = () => {
    appendPart(parts, buffer, forceOverline)
    buffer = ""
  }

  for (let index = 0; index < kicadText.length; ) {
    if (kicadText.startsWith("~{", index)) {
      const closeIndex = findClosingBrace(kicadText, index + 1)
      if (closeIndex !== -1) {
        flush()
        for (const part of parseParts(
          kicadText.slice(index + 2, closeIndex),
          true,
        )) {
          appendPart(parts, part.text, true)
        }
        index = closeIndex + 1
        continue
      }
    }

    buffer += kicadText[index]
    index += 1
  }

  flush()
  return parts
}

/** Parse KiCad's documented ~{text} overline markup. */
export const parseKicadOverlineText = (kicadText: string) => {
  const textParts = parseParts(kicadText)
  const text = textParts.map((part) => part.text).join("")
  const hasOverline = textParts.some((part) => part.is_overlined)
  const isFullyOverlined =
    textParts.length > 0 && textParts.every((part) => part.is_overlined)

  return {
    text,
    textParts: hasOverline ? textParts : undefined,
    isFullyOverlined,
  }
}

/** Preserve the existing N_ semantic convention for fully active-low ports. */
export const getSourcePortNameFromKicadText = (kicadText: string) => {
  const parsedText = parseKicadOverlineText(kicadText)
  return parsedText.isFullyOverlined ? `N_${parsedText.text}` : parsedText.text
}
