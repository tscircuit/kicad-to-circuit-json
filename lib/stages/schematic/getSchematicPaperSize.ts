import type { KicadSch } from "kicadts"

// Circuit JSON's sheet renderer uses a 10.16 mm resistor pin span of 1.1 units.
export const SCHEMATIC_UNIT_TO_MM = 10.16 / 1.1

const paperDimensions: Record<string, { width: number; height: number }> = {
  A0: { width: 1189, height: 841 },
  A1: { width: 841, height: 594 },
  A2: { width: 594, height: 420 },
  A3: { width: 420, height: 297 },
  A4: { width: 297, height: 210 },
  A5: { width: 210, height: 148 },
  A: { width: 279.4, height: 215.9 },
  B: { width: 431.8, height: 279.4 },
  C: { width: 558.8, height: 431.8 },
  D: { width: 863.6, height: 558.8 },
  E: { width: 1117.6, height: 863.6 },
  USLetter: { width: 279.4, height: 215.9 },
  USLegal: { width: 355.6, height: 215.9 },
  USLedger: { width: 431.8, height: 279.4 },
}

export function getSchematicPaperSize(paper: KicadSch["paper"]) {
  const dimensions =
    paper?.customSize ??
    paperDimensions[paper?.size ?? "A4"] ??
    paperDimensions.A4!
  return paper?.isPortrait
    ? { width: dimensions.height, height: dimensions.width }
    : dimensions
}
