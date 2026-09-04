export interface DecodedKicadText {
  text: string
  overlineRanges: Array<{
    startIndex: number
    endIndex: number
  }>
}

/**
 * Parses KiCad text markup into plain text and the character ranges that need
 * an overline. Rendering is deferred to consumers of Circuit JSON so the
 * decoration follows the renderer's actual text metrics.
 */
export const parseKicadText = (text: string): DecodedKicadText => {
  const decodedSlashes = text.replaceAll("{slash}", "/")
  let decoded = ""
  const overlineRanges: DecodedKicadText["overlineRanges"] = []

  for (let index = 0; index < decodedSlashes.length; index++) {
    if (decodedSlashes[index] !== "~" || decodedSlashes[index + 1] !== "{") {
      decoded += decodedSlashes[index]
      continue
    }

    const closingBraceIndex = findClosingBrace(decodedSlashes, index + 1)
    if (closingBraceIndex === -1) {
      decoded += decodedSlashes[index]
      continue
    }

    const overlinedText = decodedSlashes.slice(index + 2, closingBraceIndex)
    const start = Array.from(decoded).length
    decoded += overlinedText
    const end = start + Array.from(overlinedText).length
    if (end > start) {
      overlineRanges.push({ startIndex: start, endIndex: end })
    }
    index = closingBraceIndex
  }

  return { text: decoded, overlineRanges }
}

export const decodeKicadText = (text: string): string =>
  parseKicadText(text).text

const findClosingBrace = (text: string, openingBraceIndex: number): number => {
  let depth = 0

  for (let index = openingBraceIndex; index < text.length; index++) {
    if (text[index] === "{") depth++
    if (text[index] === "}") depth--
    if (depth === 0) return index
  }

  return -1
}
