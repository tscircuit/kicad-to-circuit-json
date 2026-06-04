import type { FootprintPad } from "kicadts"
import { applyToPoint } from "transformation-matrix"
import type { ConverterContext } from "../../../types"
import type { PadPortInfo } from "./process-ports"

export type Point = { x: number; y: number }
export type Size = { x: number; y: number }

export function getPadAt(pad: FootprintPad) {
  return pad.at || { x: 0, y: 0, angle: 0 }
}

export function getPadType(pad: FootprintPad): PadPortInfo["padType"] {
  const padType = pad.padType || "thru_hole"

  if (
    padType === "smd" ||
    padType === "thru_hole" ||
    padType === "np_thru_hole"
  ) {
    return padType
  }

  return "thru_hole"
}

export function getPadShape(pad: FootprintPad): string {
  return pad.shape || "circle"
}

export function getPadSize(pad: FootprintPad): Size {
  return {
    x: pad.size?.width || 1,
    y: pad.size?.height || 1,
  }
}

export function getPadRoundRectRadius(
  pad: FootprintPad,
  size: Size,
): number | undefined {
  const privatePad = pad as unknown as {
    _sxRoundrectRatio?: { value?: number }
    roundrect_rratio?: number
  }
  const roundrectRatio =
    privatePad._sxRoundrectRatio?.value ??
    privatePad.roundrect_rratio ??
    pad.roundrectRatio
  if (roundrectRatio === undefined) return undefined

  const minDimension = Math.min(size.x, size.y)
  return (minDimension * roundrectRatio) / 2
}

export function rotatePadOffset({
  padAt,
  componentCcwRotationDegrees,
}: {
  padAt: { x: number; y: number }
  componentCcwRotationDegrees: number
}): Point {
  const rotationRad = (-componentCcwRotationDegrees * Math.PI) / 180

  return {
    x: padAt.x * Math.cos(rotationRad) - padAt.y * Math.sin(rotationRad),
    y: padAt.x * Math.sin(rotationRad) + padAt.y * Math.cos(rotationRad),
  }
}

export function getPadKicadPosition({
  kicadComponentPos,
  padAt,
  componentCcwRotationDegrees,
}: {
  kicadComponentPos: Point
  padAt: { x: number; y: number }
  componentCcwRotationDegrees: number
}): Point {
  const rotatedPadOffset = rotatePadOffset({
    padAt,
    componentCcwRotationDegrees,
  })
  return {
    x: kicadComponentPos.x + rotatedPadOffset.x,
    y: kicadComponentPos.y + rotatedPadOffset.y,
  }
}

export function getGlobalPadPosition(
  ctx: ConverterContext,
  padKicadPos: Point,
): Point {
  return applyToPoint(ctx.k2cMatPcb!, padKicadPos)
}

export function normalizeRotationDegrees(
  rotationDegrees: number | undefined,
): number {
  if (!rotationDegrees) return 0

  const normalized = rotationDegrees % 360
  return normalized < 0 ? normalized + 360 : normalized
}

export function getRightAngleTurns(rotationDegrees: number): number | null {
  const quarterTurns = rotationDegrees / 90

  if (Math.abs(quarterTurns - Math.round(quarterTurns)) > 1e-9) {
    return null
  }

  return Math.round(quarterTurns)
}
