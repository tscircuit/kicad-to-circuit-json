export interface PcbPoint {
  x: number
  y: number
}

const FULL_TURN = Math.PI * 2

export function normalizeToArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function getLayerNames(layer: any): string[] {
  if (!layer) return []
  if (typeof layer === "string") return [layer]
  return layer.names || layer._names || []
}

export function getGraphicLayerNames(graphic: any): string[] {
  return getLayerNames(graphic?.layer ?? graphic?._sxLayer)
}

export function getPcbPoint(point: any): PcbPoint {
  return {
    x: point?.x ?? point?._x ?? 0,
    y: point?.y ?? point?._y ?? 0,
  }
}

export function getLineStartEnd(line: any): {
  start: PcbPoint
  end: PcbPoint
} {
  return {
    start: getPcbPoint(line.start ?? line._sxStart),
    end: getPcbPoint(line.end ?? line._sxEnd),
  }
}

export function getArcStartMidEnd(arc: any): {
  start: PcbPoint
  mid: PcbPoint
  end: PcbPoint
} {
  return {
    start: getPcbPoint(arc.start ?? arc._start ?? arc._sxStart),
    mid: getPcbPoint(arc.mid ?? arc._mid ?? arc._sxMid),
    end: getPcbPoint(arc.end ?? arc._end ?? arc._sxEnd),
  }
}

export function getGraphicArcs(kicadPcb: any): any[] {
  const explicitGraphicArcs = normalizeToArray(kicadPcb?.graphicArcs)
  if (explicitGraphicArcs.length > 0) {
    return explicitGraphicArcs
  }

  return normalizeToArray(kicadPcb?._otherChildren).filter(
    (child) => child?.token === "gr_arc",
  )
}

export function getGraphicCurves(kicadPcb: any): any[] {
  const explicitGraphicCurves = normalizeToArray(kicadPcb?.graphicCurves)
  if (explicitGraphicCurves.length > 0) {
    return explicitGraphicCurves
  }

  return normalizeToArray(kicadPcb?._otherChildren).filter(
    (child) => child?.token === "gr_curve",
  )
}

export function getTopLevelCopperArcs(kicadPcb: any): any[] {
  const explicitArcs = normalizeToArray(kicadPcb?.arcs)
  if (explicitArcs.length > 0) {
    return explicitArcs
  }

  return normalizeToArray(kicadPcb?._otherChildren).filter(
    (child) => child?.token === "arc",
  )
}

export function approximateArcPoints(
  start: PcbPoint,
  mid: PcbPoint,
  end: PcbPoint,
  options?: {
    segmentLength?: number
    minSegments?: number
  },
): PcbPoint[] {
  const geometry = getArcGeometry(start, mid, end)

  if (!geometry) {
    return [start, end]
  }

  const segmentLength = options?.segmentLength ?? 0.25
  const minSegments = options?.minSegments ?? 8
  const arcLength = Math.abs(geometry.radius * geometry.sweepAngle)
  const numSegments = Math.max(
    2,
    minSegments,
    Math.ceil(arcLength / segmentLength),
  )

  const points: PcbPoint[] = []

  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments
    const angle = geometry.startAngle + geometry.sweepAngle * t
    points.push({
      x: geometry.center.x + geometry.radius * Math.cos(angle),
      y: geometry.center.y + geometry.radius * Math.sin(angle),
    })
  }

  return points
}

export function getCurvePoints(curve: any): {
  start: PcbPoint
  control1: PcbPoint
  control2: PcbPoint
  end: PcbPoint
} | null {
  const ptsData =
    curve?._sxPts?.points ?? curve?.pts?.points ?? curve?.points ?? []
  const xyPoints = ptsData
    .filter((point: any) => point?.token === "xy")
    .map((point: any) => getPcbPoint(point))

  if (xyPoints.length < 4) {
    return null
  }

  return {
    start: xyPoints[0]!,
    control1: xyPoints[1]!,
    control2: xyPoints[2]!,
    end: xyPoints[3]!,
  }
}

export function approximateCubicBezierPoints(
  start: PcbPoint,
  control1: PcbPoint,
  control2: PcbPoint,
  end: PcbPoint,
  options?: {
    segmentLength?: number
    minSegments?: number
  },
): PcbPoint[] {
  const segmentLength = options?.segmentLength ?? 0.25
  const minSegments = options?.minSegments ?? 8
  const controlPolygonLength =
    getDistance(start, control1) +
    getDistance(control1, control2) +
    getDistance(control2, end)
  const numSegments = Math.max(
    2,
    minSegments,
    Math.ceil(controlPolygonLength / segmentLength),
  )

  const points: PcbPoint[] = []

  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments
    const omt = 1 - t
    points.push({
      x:
        omt ** 3 * start.x +
        3 * omt ** 2 * t * control1.x +
        3 * omt * t ** 2 * control2.x +
        t ** 3 * end.x,
      y:
        omt ** 3 * start.y +
        3 * omt ** 2 * t * control1.y +
        3 * omt * t ** 2 * control2.y +
        t ** 3 * end.y,
    })
  }

  return points
}

function getArcGeometry(
  start: PcbPoint,
  mid: PcbPoint,
  end: PcbPoint,
): {
  center: PcbPoint
  radius: number
  startAngle: number
  sweepAngle: number
} | null {
  const circle = calculateArcCenter(start, mid, end)

  if (!circle) {
    return null
  }

  const startAngle = Math.atan2(
    start.y - circle.center.y,
    start.x - circle.center.x,
  )
  const midAngle = Math.atan2(mid.y - circle.center.y, mid.x - circle.center.x)
  const endAngle = Math.atan2(end.y - circle.center.y, end.x - circle.center.x)

  let sweepAngle = normalizeSignedAngle(endAngle - startAngle)
  const midSweep = normalizeSignedAngle(midAngle - startAngle)
  const isCounterClockwise = sweepAngle > 0
  const midIsBetween =
    (isCounterClockwise && midSweep > 0 && midSweep < sweepAngle) ||
    (!isCounterClockwise && midSweep < 0 && midSweep > sweepAngle)

  if (!midIsBetween) {
    sweepAngle =
      sweepAngle > 0 ? sweepAngle - FULL_TURN : sweepAngle + FULL_TURN
  }

  return {
    center: circle.center,
    radius: circle.radius,
    startAngle,
    sweepAngle,
  }
}

function normalizeSignedAngle(angle: number): number {
  while (angle <= -Math.PI) angle += FULL_TURN
  while (angle > Math.PI) angle -= FULL_TURN
  return angle
}

function calculateArcCenter(
  p1: PcbPoint,
  p2: PcbPoint,
  p3: PcbPoint,
): { center: PcbPoint; radius: number } | null {
  const ax = p1.x
  const ay = p1.y
  const bx = p2.x
  const by = p2.y
  const cx = p3.x
  const cy = p3.y

  const determinant = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))

  if (Math.abs(determinant) < 1e-10) {
    return null
  }

  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    determinant
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    determinant

  return {
    center: { x: ux, y: uy },
    radius: Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2),
  }
}

function getDistance(a: PcbPoint, b: PcbPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}
