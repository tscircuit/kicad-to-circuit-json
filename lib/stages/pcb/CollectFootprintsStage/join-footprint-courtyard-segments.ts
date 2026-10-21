import Flatten from "@flatten-js/core"
import type { PcbCourtyardOutline } from "circuit-json"
import type { ConverterContext, Point } from "../../../types"

/** Compare board-world points (mm, +X right, +Y up, +Z above; right-handed).
 * Arc tessellation can introduce floating-point roundoff at shared endpoints.
 */
const endpointsMatch = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6

/** Return board-world endpoint points (mm, +X right, +Y up, +Z above;
 * right-handed). Placement translation is already applied.
 */
const getEndpoints = (segment: PcbCourtyardOutline) => [
  segment.outline[0]!,
  segment.outline[segment.outline.length - 1]!,
]

/**
 * Join fp_line/fp_arc paths from one footprint into closed courtyard contours.
 * Input/output are points in Circuit JSON board world space, in mm: +X right,
 * +Y up, +Z above (right-handed). Placement/translation is already applied;
 * joining only reorders points and snaps matching endpoints. Layers never mix.
 * Open, branched, degenerate and self-intersecting chains are omitted with an
 * import warning.
 */
export function joinFootprintCourtyardSegments({
  ctx,
  courtyardSegments,
  footprintReference,
}: {
  ctx: ConverterContext
  courtyardSegments: PcbCourtyardOutline[]
  footprintReference: string
}) {
  const pendingSegments = [...courtyardSegments]
  while (pendingSegments.length > 0) {
    const firstSegment = pendingSegments.shift()!
    const connectedSegments = [firstSegment]
    for (let pendingIndex = 0; pendingIndex < pendingSegments.length; ) {
      const pendingSegment = pendingSegments[pendingIndex]!
      const touchesContour =
        pendingSegment.layer === firstSegment.layer &&
        connectedSegments.some((connectedSegment) =>
          getEndpoints(connectedSegment).some((connectedEndpoint) =>
            getEndpoints(pendingSegment).some((pendingEndpoint) =>
              endpointsMatch(connectedEndpoint, pendingEndpoint),
            ),
          ),
        )
      if (touchesContour) {
        connectedSegments.push(...pendingSegments.splice(pendingIndex, 1))
        pendingIndex = 0
      } else {
        pendingIndex++
      }
    }

    const endpoints = connectedSegments.flatMap(getEndpoints)
    const isClosedChain = endpoints.every(
      (endpoint) =>
        endpoints.filter((otherEndpoint) =>
          endpointsMatch(endpoint, otherEndpoint),
        ).length === 2,
    )
    const outline = [...firstSegment.outline]
    const remainingSegments = connectedSegments.slice(1)
    if (isClosedChain) {
      while (remainingSegments.length > 0) {
        const tail = outline[outline.length - 1]!
        const nextSegmentIndex = remainingSegments.findIndex((segment) =>
          getEndpoints(segment).some((endpoint) =>
            endpointsMatch(tail, endpoint),
          ),
        )
        const nextSegment = remainingSegments.splice(nextSegmentIndex, 1)[0]!
        const nextPoints = endpointsMatch(tail, nextSegment.outline[0]!)
          ? nextSegment.outline
          : [...nextSegment.outline].reverse()
        outline.push(...nextPoints.slice(1))
      }
      outline[outline.length - 1] = outline[0]!
    }

    const polygon = isClosedChain
      ? new Flatten.Polygon(outline.map(({ x, y }) => [x, y]))
      : null
    const isValidContour =
      polygon !== null && polygon.area() > 1e-12 && polygon.isValid()

    for (const segment of connectedSegments) {
      if (isValidContour && segment === firstSegment) continue
      ctx.db.pcb_courtyard_outline.delete(segment.pcb_courtyard_outline_id)
    }
    if (isValidContour) {
      ctx.db.pcb_courtyard_outline.update(
        firstSegment.pcb_courtyard_outline_id,
        {
          outline,
        },
      )
    } else {
      const reason = isClosedChain ? "invalid" : "open or branched"
      ;(ctx.warnings ??= []).push(
        `Footprint ${footprintReference}: skipped an ${reason} courtyard contour on the ${firstSegment.layer} layer; courtyard overlap checks are unavailable for that contour.`,
      )
    }
  }
}
