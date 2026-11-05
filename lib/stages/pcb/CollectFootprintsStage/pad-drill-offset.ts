import type { PadDrill } from "kicadts"
import { rotatePoint } from "./process-graphics"

/**
 * KiCad `(drill ... (offset x y))` is pad-local in KiCad's Y-up frame.
 * Circuit JSON `hole_offset_*` is relative to the pad center after the PCB
 * transform `scale(1, -1)`, so rotate by the pad's board angle then flip Y.
 */
export function getCircuitJsonHoleOffset(params: {
  drill?: PadDrill
  padAngleDegrees?: number
}): { hole_offset_x: number; hole_offset_y: number } {
  const ox = params.drill?.offset?.x ?? 0
  const oy = params.drill?.offset?.y ?? 0
  if (ox === 0 && oy === 0) {
    return { hole_offset_x: 0, hole_offset_y: 0 }
  }

  const rotated = rotatePoint({
    point: { x: ox, y: oy },
    ccwRotationDegrees: params.padAngleDegrees ?? 0,
  })

  const snapZero = (value: number) => (Math.abs(value) < 1e-12 ? 0 : value)

  return {
    hole_offset_x: snapZero(rotated.x),
    hole_offset_y: snapZero(-rotated.y),
  }
}
