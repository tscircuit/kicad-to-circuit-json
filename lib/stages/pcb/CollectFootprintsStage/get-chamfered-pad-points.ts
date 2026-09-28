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
  const corners = [
    { name: "top_left", x: -width / 2, y: -height / 2 },
    { name: "top_right", x: width / 2, y: -height / 2 },
    { name: "bottom_right", x: width / 2, y: height / 2 },
    { name: "bottom_left", x: -width / 2, y: height / 2 },
  ]
  const points: Point[] = []
  for (let i = 0; i < corners.length; i++) {
    const corner = corners[i]!
    const previous = corners[(i + 3) % 4]!
    const next = corners[(i + 1) % 4]!
    const chamfered = chamferCorners.includes(corner.name)
    const distance =
      Math.min(width, height) * (chamfered ? chamferRatio : roundrectRatio)
    if (distance === 0) {
      points.push({ x: corner.x, y: corner.y })
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
      points.push(start, end)
    } else {
      // A rounded corner's 45-degree point lies r - r/sqrt(2) from its vertex.
      const inset = distance * (1 - 1 / Math.SQRT2)
      points.push(
        ...approximateArcPoints({
          start,
          end,
          mid: {
            x: corner.x + (incoming.x + outgoing.x) * inset,
            y: corner.y + (incoming.y + outgoing.y) * inset,
          },
        }),
      )
    }
  }
  return points
}
