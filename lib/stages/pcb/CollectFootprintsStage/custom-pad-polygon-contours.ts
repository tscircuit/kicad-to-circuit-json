import type { PcbSmtPadPolygon } from "circuit-json"
import type { PadPrimitiveGrPoly } from "kicadts"
import type { Point } from "../../../types"

export type PolygonContour = Point[]

export type PcbSmtPadPolygonWithContours = PcbSmtPadPolygon & {
  contours?: PolygonContour[]
}

export function getCustomPadPolygonContours(
  polygonPrimitive: PadPrimitiveGrPoly,
): PolygonContour[] {
  return polygonPrimitive.contours
    .map((contour) =>
      contour.points.flatMap((point) =>
        "x" in point && "y" in point ? [{ x: point.x, y: point.y }] : [],
      ),
    )
    .filter((contour) => contour.length > 0)
}

export function attachPadPolygonContours(
  pad: PcbSmtPadPolygon,
  contours: PolygonContour[],
): void {
  Object.defineProperty(pad, "contours", {
    value: contours,
    enumerable: false,
    configurable: true,
  })
}
