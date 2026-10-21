import Flatten from "@flatten-js/core"
import type { PcbCourtyardOutline } from "circuit-json"
import type { Point } from "../../../types"

/** Board-world points in mm: +X right, +Y up, +Z above (right-handed),
 * with placement translation already applied.
 */
export type FootprintCourtyardSegment = Pick<
  PcbCourtyardOutline,
  "layer" | "outline"
>

const getEndpoints = ({ outline }: FootprintCourtyardSegment) => [
  outline[0]!,
  outline[outline.length - 1]!,
]

// Allow floating-point drift introduced by arc tessellation.
const endpointsMatch = (endpoint: Point, otherEndpoint: Point) =>
  Math.abs(endpoint.x - otherEndpoint.x) < 1e-6 &&
  Math.abs(endpoint.y - otherEndpoint.y) < 1e-6

const segmentsTouch = (
  segment: FootprintCourtyardSegment,
  candidate: FootprintCourtyardSegment,
) =>
  segment.layer === candidate.layer &&
  getEndpoints(segment).some((endpoint) =>
    getEndpoints(candidate).some((candidateEndpoint) =>
      endpointsMatch(endpoint, candidateEndpoint),
    ),
  )

function groupConnectedSegments(segments: FootprintCourtyardSegment[]) {
  const segmentGroups: FootprintCourtyardSegment[][] = []
  let pendingSegments = [...segments]
  while (pendingSegments.length > 0) {
    const connectedSegments = [pendingSegments.shift()!]
    for (const segment of connectedSegments) {
      const touchingSegments = pendingSegments.filter((candidate) =>
        segmentsTouch(segment, candidate),
      )
      connectedSegments.push(...touchingSegments)
      pendingSegments = pendingSegments.filter(
        (candidate) => !touchingSegments.includes(candidate),
      )
    }
    segmentGroups.push(connectedSegments)
  }
  return segmentGroups
}

/** Assemble closed contours per layer, reporting malformed chains separately. */
export function joinFootprintCourtyardSegments(
  courtyardSegments: FootprintCourtyardSegment[],
) {
  const contours: FootprintCourtyardSegment[] = []
  const invalidContours: Array<{
    layer: FootprintCourtyardSegment["layer"]
    reason: "invalid" | "open_or_branched"
  }> = []

  for (const connectedSegments of groupConnectedSegments(courtyardSegments)) {
    const firstSegment = connectedSegments[0]!
    const { layer } = firstSegment
    const endpoints = connectedSegments.flatMap(getEndpoints)
    const isClosed = endpoints.every(
      (endpoint) =>
        endpoints.filter((other) => endpointsMatch(endpoint, other)).length ===
        2,
    )
    if (!isClosed) {
      invalidContours.push({ layer, reason: "open_or_branched" })
      continue
    }

    const outline = [...firstSegment.outline]
    const remainingSegments = connectedSegments.slice(1)
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

    const polygon = new Flatten.Polygon(outline.map(({ x, y }) => [x, y]))
    if (polygon.area() > 1e-12 && polygon.isValid()) {
      contours.push({ layer, outline })
    } else {
      invalidContours.push({ layer, reason: "invalid" })
    }
  }
  return { contours, invalidContours }
}
