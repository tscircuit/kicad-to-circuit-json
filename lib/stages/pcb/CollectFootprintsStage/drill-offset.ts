import type { FootprintPad } from "kicadts"
import { rotatePoint } from "./process-graphics"

/**
 * KiCad stores a pad's drill offset in the pad's local frame, where it rotates
 * with the pad angle like custom pad primitives do. Circuit JSON hole offsets
 * are board-space vectors, so the offset rotates by the pad angle and then
 * flips Y with the rest of the board geometry.
 */
export function getDrillOffsetInCircuitJsonSpace(params: {
  drill: FootprintPad["drill"]
  padAngleDegrees: number | undefined
}): { x: number; y: number } {
  const { drill, padAngleDegrees } = params
  const offset = drill?.offset
  if (!offset || (offset.x === 0 && offset.y === 0)) {
    return { x: 0, y: 0 }
  }

  const rotated = rotatePoint({
    point: { x: offset.x, y: offset.y },
    ccwRotationDegrees: -(padAngleDegrees ?? 0),
  })

  return { x: rotated.x, y: -rotated.y }
}
