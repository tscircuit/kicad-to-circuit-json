import type {
  PcbSmtPadPill,
  PcbSmtPadRect,
  PcbSmtPadRotatedPill,
  PcbSmtPadRotatedRect,
} from "circuit-json"
import { getRightAngleTurns, normalizeRotationDegrees } from "./pad-rotation"

type RectangleShape =
  | Pick<PcbSmtPadRect, "shape" | "width" | "height">
  | Pick<PcbSmtPadRotatedRect, "shape" | "width" | "height" | "ccw_rotation">

type PadShape =
  | RectangleShape
  | Pick<PcbSmtPadPill, "shape" | "width" | "height" | "radius">
  | Pick<
      PcbSmtPadRotatedPill,
      "shape" | "width" | "height" | "radius" | "ccw_rotation"
    >

type PadShapeOptions = {
  shape: "rect" | "pill"
  width: number
  height: number
  ccwRotationDegrees?: number
  radius?: number
}

export function getPadShape(
  options: PadShapeOptions & { shape: "rect" },
): RectangleShape
export function getPadShape(options: PadShapeOptions): PadShape
export function getPadShape({
  shape,
  width,
  height,
  ccwRotationDegrees,
  radius = Math.min(width, height) / 2,
}: PadShapeOptions): PadShape {
  const rotation = normalizeRotationDegrees(ccwRotationDegrees)
  const turns = getRightAngleTurns(rotation)
  if (turns !== null && turns % 2 !== 0) {
    ;[width, height] = [height, width]
  }

  if (shape === "pill") {
    if (turns === null) {
      return {
        shape: "rotated_pill",
        width,
        height,
        radius,
        ccw_rotation: rotation,
      }
    }
    return { shape: "pill", width, height, radius }
  }
  if (turns === null) {
    return { shape: "rotated_rect", width, height, ccw_rotation: rotation }
  }
  return { shape: "rect", width, height }
}
