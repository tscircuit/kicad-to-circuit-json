export interface PolygonPoint {
  x: number
  y: number
}

export function isPointInsidePolygonContours(
  point: PolygonPoint,
  contours: PolygonPoint[][],
  tolerance = 0,
) {
  const validContours = contours.filter((contour) => contour.length >= 3)
  if (validContours.length === 0) return false

  for (const contour of validContours) {
    if (isPointOnContourBoundary(point, contour, tolerance)) {
      return true
    }
  }

  let inside = false
  for (const contour of validContours) {
    if (isPointInsideContourInterior(point, contour)) {
      inside = !inside
    }
  }

  return inside
}

function isPointOnContourBoundary(
  point: PolygonPoint,
  contour: PolygonPoint[],
  tolerance: number,
) {
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    if (getDistanceToSegment(point, contour[j]!, contour[i]!) <= tolerance) {
      return true
    }
  }

  return false
}

function isPointInsideContourInterior(
  point: PolygonPoint,
  contour: PolygonPoint[],
) {
  let inside = false
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const current = contour[i]!
    const previous = contour[j]!
    const crosses =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x

    if (crosses) inside = !inside
  }

  return inside
}

function getDistanceToSegment(
  point: PolygonPoint,
  start: PolygonPoint,
  end: PolygonPoint,
) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq,
    ),
  )
  const projectedX = start.x + projection * dx
  const projectedY = start.y + projection * dy
  return Math.hypot(point.x - projectedX, point.y - projectedY)
}
