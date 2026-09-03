import type { SymbolArc } from "kicadts"

export interface KicadSymbolArcPoint {
  x: number
  y: number
}

export interface KicadSymbolArcPoints {
  start: KicadSymbolArcPoint
  mid: KicadSymbolArcPoint
  end: KicadSymbolArcPoint
}

const getPoint = (
  arc: SymbolArc,
  token: "start" | "mid" | "end",
): KicadSymbolArcPoint | undefined => {
  const child = arc
    .getChildren()
    .find((candidate) => candidate.token === token) as
    | { x?: number; y?: number }
    | undefined
  if (child?.x === undefined || child.y === undefined) return undefined
  return { x: child.x, y: child.y }
}

const getLegacyMidpoint = (arc: SymbolArc): KicadSymbolArcPoint | undefined => {
  const radius = arc.radius
  const center = radius?.at
  const length = radius?.length
  const angles = radius?.angles
  if (!center || length === undefined || !angles) return undefined

  let endAngle = angles.end
  while (endAngle <= angles.start) endAngle += 360
  const midAngleRadians = (((angles.start + endAngle) / 2) * Math.PI) / 180
  return {
    x: center.x + Math.cos(midAngleRadians) * length,
    y: center.y + Math.sin(midAngleRadians) * length,
  }
}

export const getKicadSymbolArcPoints = (
  arc: SymbolArc,
): KicadSymbolArcPoints | null => {
  const start = getPoint(arc, "start")
  const mid = getPoint(arc, "mid") ?? getLegacyMidpoint(arc)
  const end = getPoint(arc, "end")
  if (!start || !mid || !end) return null
  return { start, mid, end }
}
