import type { Point } from "circuit-json"

type HorizontalTextAnchor = "left" | "center" | "right"
type VerticalTextAnchor = "top" | "middle" | "bottom"

const KICAD_GLYPH_WIDTH_EM = 0.6
const OVERLINE_OFFSET_EM: Record<VerticalTextAnchor, number> = {
  top: 0.2,
  middle: 0.72,
  bottom: 1.15,
}
const OVERLINE_STROKE_EM = 0.08
const MINIMUM_OVERLINE_STROKE_WIDTH = 0.008
const JOINING_OVERLINE_GLYPH = "─"

export interface DecodedKicadText {
  text: string
  overlineRanges: Array<{ start: number; end: number }>
}

/**
 * Parses KiCad text markup into plain text and the character ranges that need
 * an overline. The ranges are emitted as schematic lines because combining
 * Unicode marks produce a separate, broken bar over every glyph.
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
    if (end > start) overlineRanges.push({ start, end })
    index = closingBraceIndex
  }

  return { text: decoded, overlineRanges }
}

export const decodeKicadText = (text: string): string =>
  parseKicadText(text).text

export const estimateKicadTextWidth = (
  text: string,
  fontSize: number,
): number => Array.from(text).length * fontSize * KICAD_GLYPH_WIDTH_EM

export const getKicadOverlineStrokeWidth = (fontSize: number): number =>
  Math.max(MINIMUM_OVERLINE_STROKE_WIDTH, fontSize * OVERLINE_STROKE_EM)

export const createJoiningOverlineText = (
  range: DecodedKicadText["overlineRanges"][number],
): string => JOINING_OVERLINE_GLYPH.repeat(range.end - range.start)

export const getKicadOverlineSegment = (params: {
  text: string
  range: DecodedKicadText["overlineRanges"][number]
  fontSize: number
  position: Point
  rotation: number
  horizontalAnchor?: HorizontalTextAnchor
  verticalAnchor?: VerticalTextAnchor
}): { start: Point; end: Point; center: Point } => {
  const {
    text,
    range,
    fontSize,
    position,
    rotation,
    horizontalAnchor = "center",
    verticalAnchor = "middle",
  } = params
  const characterWidth = fontSize * KICAD_GLYPH_WIDTH_EM
  const textWidth = estimateKicadTextWidth(text, fontSize)
  const textStartOffset =
    horizontalAnchor === "left"
      ? 0
      : horizontalAnchor === "right"
        ? -textWidth
        : -textWidth / 2
  const startOffset = textStartOffset + range.start * characterWidth
  const endOffset = textStartOffset + range.end * characterWidth
  const overlineOffset = fontSize * OVERLINE_OFFSET_EM[verticalAnchor]
  const rotationRadians = (rotation * Math.PI) / 180
  const along = {
    x: Math.cos(rotationRadians),
    y: -Math.sin(rotationRadians),
  }
  const above = {
    x: Math.sin(rotationRadians),
    y: Math.cos(rotationRadians),
  }
  const pointAtOffset = (offset: number): Point => ({
    x: position.x + along.x * offset + above.x * overlineOffset,
    y: position.y + along.y * offset + above.y * overlineOffset,
  })

  return {
    start: pointAtOffset(startOffset),
    end: pointAtOffset(endOffset),
    center: pointAtOffset((startOffset + endOffset) / 2),
  }
}

const findClosingBrace = (text: string, openingBraceIndex: number): number => {
  let depth = 0

  for (let index = openingBraceIndex; index < text.length; index++) {
    if (text[index] === "{") depth++
    if (text[index] === "}") depth--
    if (depth === 0) return index
  }

  return -1
}
