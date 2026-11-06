import type { Point } from "../../../types"
import { approximateArcPoints } from "../arc-utils"

/** KiCad pad-local points, before the pad angle and Y-axis conversion. */
export function getChamferedPadPoints({
  width,
  height,
  chamferRatio,
  chamferCorners,
  roundrectRatio,
}: {
  width: number
  height: number
  chamferRatio: number
  chamferCorners: readonly string[]
  roundrectRatio: number
}): Point[] {
  const clampRatio = (ratio: number) =>
    Number.isFinite(ratio) ? Math.max(0, Math.min(0.5, ratio)) : 0
  const safeChamferRatio = clampRatio(chamferRatio)
  const safeRoundrectRatio = clampRatio(roundrectRatio)
  const minDim = Math.max(
    0,
    Math.min(
      Number.isFinite(width) ? width : 0,
      Number.isFinite(height) ? height : 0,
    ),
  )

  const corners = [
    { name: "top_left", x: -width / 2, y: -height / 2 },
    { name: "top_right", x: width / 2, y: -height / 2 },
    { name: "bottom_right", x: width / 2, y: height / 2 },
    { name: "bottom_left", x: -width / 2, y: height / 2 },
  ]
  const points: Point[] = []
  const pushUniquePoint = (pt: Point) => {
    const prev = points[points.length - 1]
    if (
      prev &&
      Math.abs(prev.x - pt.x) < 1e-9 &&
      Math.abs(prev.y - pt.y) < 1e-9
    ) {
      return
    }
    points.push(pt)
  }
  for (let i = 0; i < corners.length; i++) {
    const corner = corners[i]!
    const previous = corners[(i + 3) % 4]!
    const next = corners[(i + 1) % 4]!
    const chamfered = chamferCorners.includes(corner.name)
    const distance =
      minDim * (chamfered ? safeChamferRatio : safeRoundrectRatio)
    if (distance <= 0) {
      pushUniquePoint({ x: corner.x, y: corner.y })
      continue
    }
    const incoming = {
      x: Math.sign(previous.x - corner.x),
      y: Math.sign(previous.y - corner.y),
    }
    const outgoing = {
      x: Math.sign(next.x - corner.x),
      y: Math.sign(next.y - corner.y),
    }
    const start = {
      x: corner.x + incoming.x * distance,
      y: corner.y + incoming.y * distance,
    }
    const end = {
      x: corner.x + outgoing.x * distance,
      y: corner.y + outgoing.y * distance,
    }
    if (chamfered) {
      pushUniquePoint(start)
      pushUniquePoint(end)
    } else {
      // A rounded corner's 45-degree point lies r - r/sqrt(2) from its vertex.
      const inset = distance * (1 - 1 / Math.SQRT2)
      for (const pt of approximateArcPoints({
        start,
        end,
        mid: {
          x: corner.x + (incoming.x + outgoing.x) * inset,
          y: corner.y + (incoming.y + outgoing.y) * inset,
        },
      })) {
        pushUniquePoint(pt)
      }
    }
  }
  if (points.length > 1) {
    const first = points[0]!
    const last = points[points.length - 1]!
    if (
      Math.abs(first.x - last.x) < 1e-9 &&
      Math.abs(first.y - last.y) < 1e-9
    ) {
      points.pop()
    }
  }
  return points
}
