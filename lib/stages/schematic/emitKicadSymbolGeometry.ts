import type {
  Point,
  SchematicArc,
  SchematicCircle,
  SchematicLine,
  SchematicPath,
} from "circuit-json"
import type {
  SchematicSymbol,
  SymbolArc,
  SymbolCircle,
  SymbolPin,
  SymbolPolyline,
  SymbolRectangle,
  SymbolText,
} from "kicadts"
import {
  applyToPoint,
  compose,
  type Matrix,
  rotateDEG,
  scale,
  translate,
} from "transformation-matrix"
import type { ConverterContext } from "../../types"
import { getCircuitJsonPinLabel } from "../../utils/parse-kicad-overline-text"

const SYMBOL_STROKE_COLOR = "rgb(132, 0, 0)"
const SYMBOL_FILL_COLOR = "rgb(255, 255, 194)"
const SCHEMATIC_ARC_ANGLE_FRAME = scale(1, -1)

type ShapeChild = {
  token: string
  x?: number
  y?: number
  value?: number
  width?: number
  type?: string
}

type SymbolGeometryParams = {
  ctx: ConverterContext
  instance: SchematicSymbol
  librarySymbol: SchematicSymbol
  schematicComponentId: string
  componentCenter: Point
}

type SymbolGeometryResult = {
  size: { width: number; height: number }
}

export const getApplicableSymbolParts = (
  librarySymbol: SchematicSymbol,
  instance: SchematicSymbol,
): SchematicSymbol[] => {
  const unit = instance.unit ?? 1
  const bodyStyle = instance.bodyStyle ?? 1
  const applicableSubSymbols = librarySymbol.subSymbols.filter((subSymbol) => {
    const unitAndBodyStyle = subSymbol.libraryId?.match(/_(\d+)_(\d+)$/)
    if (!unitAndBodyStyle) return true

    const subSymbolUnit = Number(unitAndBodyStyle[1])
    const subSymbolBodyStyle = Number(unitAndBodyStyle[2])

    return (
      (subSymbolUnit === 0 || subSymbolUnit === unit) &&
      (subSymbolBodyStyle === 0 || subSymbolBodyStyle === bodyStyle)
    )
  })

  return [librarySymbol, ...applicableSubSymbols]
}

export const getPinsForSymbolInstance = (
  librarySymbol: SchematicSymbol,
  instance: SchematicSymbol,
): SymbolPin[] =>
  getApplicableSymbolParts(librarySymbol, instance).flatMap(
    (symbolPart) => symbolPart.pins,
  )

export const createSymbolTransform = (
  instance: SchematicSymbol,
  componentCenter: Point,
  scaleFactor: number,
): Matrix => {
  const mirrorX = instance.mirror === "y" ? -1 : 1
  const mirrorY = instance.mirror === "x" ? -1 : 1

  return compose(
    translate(componentCenter.x, componentCenter.y),
    scale(scaleFactor),
    rotateDEG(instance.at?.angle ?? 0),
    scale(mirrorX, mirrorY),
  )
}

export const emitKicadSymbolGeometry = ({
  ctx,
  instance,
  librarySymbol,
  schematicComponentId,
  componentCenter,
}: SymbolGeometryParams): SymbolGeometryResult => {
  if (!ctx.k2cMatSch) return { size: { width: 1, height: 1 } }

  const symbolParts = getApplicableSymbolParts(librarySymbol, instance)
  const scaleFactor = Math.abs(ctx.k2cMatSch.a || 1 / 15)
  const transform = createSymbolTransform(
    instance,
    componentCenter,
    scaleFactor,
  )
  const transformedBoundsPoints: Point[] = []
  const trackPoint = (point: Point): Point => {
    transformedBoundsPoints.push(point)
    return point
  }
  const transformPoint = (point: Point): Point =>
    trackPoint(applyToPoint(transform, point))

  for (const pin of symbolParts.flatMap((symbolPart) => symbolPart.pins)) {
    if (!pin.at) continue
    const pinStart = transformPoint(pin.at)
    if (pin.hidden || !pin.length) continue

    const pinAngle = ((pin.at.angle ?? 0) * Math.PI) / 180
    const pinEnd = transformPoint({
      x: pin.at.x + Math.cos(pinAngle) * pin.length,
      y: pin.at.y + Math.sin(pinAngle) * pin.length,
    })
    insertLine(ctx, schematicComponentId, pinStart, pinEnd, null, false)
    emitPinTexts({
      ctx,
      pin,
      pinStart,
      pinEnd,
      scaleFactor,
      pinNamesHidden: librarySymbol.pinNames?.hide === true,
      pinNumbersHidden: librarySymbol.pinNumbers?.hide === true,
      pinNameOffset: librarySymbol.pinNames?.offset ?? 0,
    })
  }

  for (const polyline of symbolParts.flatMap(
    (symbolPart) => symbolPart.polylines,
  )) {
    emitPolyline({
      ctx,
      schematicComponentId,
      polyline,
      transformPoint,
      scaleFactor,
    })
  }

  for (const rectangle of symbolParts.flatMap(
    (symbolPart) => symbolPart.rectangles,
  )) {
    emitRectangle({
      ctx,
      schematicComponentId,
      rectangle,
      transformPoint,
      scaleFactor,
    })
  }

  for (const circle of symbolParts.flatMap(
    (symbolPart) => symbolPart.circles,
  )) {
    emitCircle({
      ctx,
      schematicComponentId,
      circle,
      transform,
      transformPoint,
      scaleFactor,
    })
  }

  for (const arc of symbolParts.flatMap((symbolPart) => symbolPart.arcs)) {
    emitArc({
      ctx,
      schematicComponentId,
      arc,
      transformPoint,
      scaleFactor,
    })
  }

  for (const text of symbolParts.flatMap((symbolPart) => symbolPart.texts)) {
    emitSymbolText({ ctx, text, transform, scaleFactor })
  }

  if (transformedBoundsPoints.length === 0) {
    return { size: { width: 1, height: 1 } }
  }

  const xs = transformedBoundsPoints.map((point) => point.x)
  const ys = transformedBoundsPoints.map((point) => point.y)
  return {
    size: {
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    },
  }
}

const emitPolyline = (params: {
  ctx: ConverterContext
  schematicComponentId: string
  polyline: SymbolPolyline
  transformPoint: (point: Point) => Point
  scaleFactor: number
}) => {
  const { ctx, schematicComponentId, polyline, transformPoint, scaleFactor } =
    params
  const points =
    polyline.points?.points.flatMap((point) =>
      "x" in point && "y" in point
        ? [transformPoint({ x: point.x, y: point.y })]
        : [],
    ) ?? []
  if (points.length < 2) return

  const fillType = polyline.fill?.type
  const isFilled = fillType !== undefined && fillType !== "none"
  if (isFilled) {
    insertPath(
      ctx,
      schematicComponentId,
      points,
      toStrokeWidth(polyline.stroke?.width, scaleFactor),
      polyline.stroke?.type === "dash",
      true,
      fillType === "background" ? SYMBOL_FILL_COLOR : SYMBOL_STROKE_COLOR,
    )
    return
  }

  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]
    const end = points[index]
    if (!start || !end) continue
    insertLine(
      ctx,
      schematicComponentId,
      start,
      end,
      toStrokeWidth(polyline.stroke?.width, scaleFactor),
      polyline.stroke?.type === "dash",
    )
  }
}

const emitRectangle = (params: {
  ctx: ConverterContext
  schematicComponentId: string
  rectangle: SymbolRectangle
  transformPoint: (point: Point) => Point
  scaleFactor: number
}) => {
  const { ctx, schematicComponentId, rectangle, transformPoint, scaleFactor } =
    params
  const start = getShapePoint(rectangle, "start")
  const end = getShapePoint(rectangle, "end")
  if (!start || !end) return

  const points = [
    transformPoint(start),
    transformPoint({ x: end.x, y: start.y }),
    transformPoint(end),
    transformPoint({ x: start.x, y: end.y }),
    transformPoint(start),
  ]
  const fillType = getShapeFillType(rectangle)
  const isFilled = fillType !== undefined && fillType !== "none"
  insertPath(
    ctx,
    schematicComponentId,
    points,
    toStrokeWidth(getShapeStroke(rectangle)?.width, scaleFactor),
    getShapeStroke(rectangle)?.type === "dash",
    isFilled,
    isFilled
      ? fillType === "background"
        ? SYMBOL_FILL_COLOR
        : SYMBOL_STROKE_COLOR
      : undefined,
  )
}

const emitCircle = (params: {
  ctx: ConverterContext
  schematicComponentId: string
  circle: SymbolCircle
  transform: Matrix
  transformPoint: (point: Point) => Point
  scaleFactor: number
}) => {
  const {
    ctx,
    schematicComponentId,
    circle,
    transform,
    transformPoint,
    scaleFactor,
  } = params
  const center = getShapePoint(circle, "center")
  const radius = getShapeNumber(circle, "radius")
  if (!center || radius === undefined) return

  const transformedCenter = transformPoint(center)
  transformPoint({ x: center.x + radius, y: center.y })
  const fillType = getShapeFillType(circle)
  const isFilled = fillType !== undefined && fillType !== "none"
  const circleData: Omit<SchematicCircle, "type" | "schematic_circle_id"> = {
    schematic_component_id: schematicComponentId,
    center: transformedCenter,
    radius: radius * Math.hypot(transform.a, transform.b),
    stroke_width: toStrokeWidth(getShapeStroke(circle)?.width, scaleFactor),
    color: SYMBOL_STROKE_COLOR,
    is_filled: isFilled,
    fill_color: isFilled
      ? fillType === "background"
        ? SYMBOL_FILL_COLOR
        : SYMBOL_STROKE_COLOR
      : undefined,
    is_dashed: getShapeStroke(circle)?.type === "dash",
  }
  ctx.db.schematic_circle.insert(circleData)
}

const emitArc = (params: {
  ctx: ConverterContext
  schematicComponentId: string
  arc: SymbolArc
  transformPoint: (point: Point) => Point
  scaleFactor: number
}) => {
  const { ctx, schematicComponentId, arc, transformPoint, scaleFactor } = params
  const start = getShapePoint(arc, "start")
  const mid = getShapePoint(arc, "mid")
  const end = getShapePoint(arc, "end")
  if (!start || !mid || !end) return

  const transformedStart = transformPoint(start)
  const transformedMid = transformPoint(mid)
  const transformedEnd = transformPoint(end)
  const geometry = getArcGeometry(
    transformedStart,
    transformedMid,
    transformedEnd,
  )

  if (!geometry) {
    insertPath(
      ctx,
      schematicComponentId,
      [transformedStart, transformedMid, transformedEnd],
      toStrokeWidth(getShapeStroke(arc)?.width, scaleFactor),
      getShapeStroke(arc)?.type === "dash",
      false,
    )
    return
  }

  const arcData: Omit<SchematicArc, "type" | "schematic_arc_id"> = {
    schematic_component_id: schematicComponentId,
    ...geometry,
    stroke_width: toStrokeWidth(getShapeStroke(arc)?.width, scaleFactor),
    color: SYMBOL_STROKE_COLOR,
    is_dashed: getShapeStroke(arc)?.type === "dash",
  }
  ctx.db.schematic_arc.insert(arcData)
}

const emitSymbolText = (params: {
  ctx: ConverterContext
  text: SymbolText
  transform: Matrix
  scaleFactor: number
}) => {
  const { ctx, text, transform, scaleFactor } = params
  if (!text.value) return

  ctx.db.schematic_text.insert({
    text: text.value,
    font_size: Math.max(0.05, getFontSize(text.effects) * scaleFactor),
    position: applyToPoint(transform, text.at ?? { x: 0, y: 0 }),
    rotation: -(text.at?.angle ?? 0),
    anchor: "center",
    color: SYMBOL_STROKE_COLOR,
  })
}

const emitPinTexts = (params: {
  ctx: ConverterContext
  pin: SymbolPin
  pinStart: Point
  pinEnd: Point
  scaleFactor: number
  pinNamesHidden: boolean
  pinNumbersHidden: boolean
  pinNameOffset: number
}) => {
  const {
    ctx,
    pin,
    pinStart,
    pinEnd,
    scaleFactor,
    pinNamesHidden,
    pinNumbersHidden,
    pinNameOffset,
  } = params
  const length = Math.hypot(pinEnd.x - pinStart.x, pinEnd.y - pinStart.y)
  if (length === 0) return

  const inward = {
    x: (pinEnd.x - pinStart.x) / length,
    y: (pinEnd.y - pinStart.y) / length,
  }
  const rotation = normalizeReadableRotation(
    (Math.atan2(-inward.y, inward.x) * 180) / Math.PI,
  )
  const rotationRadians = (rotation * Math.PI) / 180
  const normalAboveInCircuitJson = {
    x: Math.sin(rotationRadians),
    y: Math.cos(rotationRadians),
  }

  const pinNumber = pin.numberString
  if (!pinNumbersHidden && pinNumber) {
    const fontSize = Math.max(
      0.05,
      getFontSize(pin._sxNumber?.effects) * scaleFactor,
    )
    ctx.db.schematic_text.insert({
      text: pinNumber,
      font_size: fontSize,
      position: {
        x:
          (pinStart.x + pinEnd.x) / 2 +
          normalAboveInCircuitJson.x * fontSize * 0.65,
        y:
          (pinStart.y + pinEnd.y) / 2 +
          normalAboveInCircuitJson.y * fontSize * 0.65,
      },
      rotation,
      anchor: "center",
      color: SYMBOL_STROKE_COLOR,
    })
  }

  if (!pinNamesHidden && pin.name && pin.name !== "~") {
    const pinNameLabel = getCircuitJsonPinLabel(pin.name)
    const fontSize = Math.max(
      0.05,
      getFontSize(pin._sxName?.effects) * scaleFactor,
    )
    const estimatedTextWidth = pinNameLabel.text.length * fontSize * 0.6
    const distanceFromBody =
      pinNameOffset * scaleFactor + estimatedTextWidth / 2
    ctx.db.schematic_text.insert({
      text: pinNameLabel.text,
      font_size: fontSize,
      position: {
        x: pinEnd.x + inward.x * distanceFromBody,
        y: pinEnd.y + inward.y * distanceFromBody,
      },
      rotation,
      anchor: "center",
      color: "rgb(0, 100, 100)",
    })
  }
}

const insertLine = (
  ctx: ConverterContext,
  schematicComponentId: string,
  start: Point,
  end: Point,
  strokeWidth: number | null,
  isDashed: boolean,
) => {
  const lineData: Omit<SchematicLine, "type" | "schematic_line_id"> = {
    schematic_component_id: schematicComponentId,
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    stroke_width: strokeWidth,
    color: SYMBOL_STROKE_COLOR,
    is_dashed: isDashed,
  }
  ctx.db.schematic_line.insert(lineData)
}

const insertPath = (
  ctx: ConverterContext,
  schematicComponentId: string,
  points: Point[],
  strokeWidth: number | null,
  isDashed: boolean,
  isFilled: boolean,
  fillColor?: string,
) => {
  const pathData: Omit<SchematicPath, "type" | "schematic_path_id"> = {
    schematic_component_id: schematicComponentId,
    points,
    stroke_width: strokeWidth,
    stroke_color: SYMBOL_STROKE_COLOR,
    is_dashed: isDashed,
    is_filled: isFilled,
    fill_color: fillColor,
  }
  ctx.db.schematic_path.insert(pathData)
}

const getShapeChildren = (shape: { getChildren(): unknown[] }) =>
  shape.getChildren() as ShapeChild[]

const getShapeChild = (
  shape: { getChildren(): unknown[] },
  token: string,
): ShapeChild | undefined =>
  getShapeChildren(shape).find((child) => child.token === token)

const getShapePoint = (
  shape: { getChildren(): unknown[] },
  token: string,
): Point | undefined => {
  const child = getShapeChild(shape, token)
  if (child?.x === undefined || child.y === undefined) return undefined
  return { x: child.x, y: child.y }
}

const getShapeNumber = (
  shape: { getChildren(): unknown[] },
  token: string,
): number | undefined => getShapeChild(shape, token)?.value

const getShapeStroke = (shape: {
  getChildren(): unknown[]
}): { width?: number; type?: string } | undefined =>
  getShapeChild(shape, "stroke")

const getShapeFillType = (shape: { getChildren(): unknown[] }) =>
  getShapeChild(shape, "fill")?.type

const toStrokeWidth = (
  width: number | undefined,
  scaleFactor: number,
): number | null => {
  if (!width) return null
  return Math.max(0.01, width * scaleFactor)
}

const getFontSize = (
  effects: { font?: { size?: { height: number; width: number } } } | undefined,
): number => {
  const size = effects?.font?.size
  return size ? Math.max(size.height, size.width) : 1.27
}

const getArcGeometry = (
  start: Point,
  mid: Point,
  end: Point,
): Pick<
  SchematicArc,
  | "center"
  | "radius"
  | "start_angle_degrees"
  | "end_angle_degrees"
  | "direction"
> | null => {
  const denominator =
    2 *
    (start.x * (mid.y - end.y) +
      mid.x * (end.y - start.y) +
      end.x * (start.y - mid.y))
  if (Math.abs(denominator) < 1e-9) return null

  const startLength = start.x ** 2 + start.y ** 2
  const midLength = mid.x ** 2 + mid.y ** 2
  const endLength = end.x ** 2 + end.y ** 2
  const center = {
    x:
      (startLength * (mid.y - end.y) +
        midLength * (end.y - start.y) +
        endLength * (start.y - mid.y)) /
      denominator,
    y:
      (startLength * (end.x - mid.x) +
        midLength * (start.x - end.x) +
        endLength * (mid.x - start.x)) /
      denominator,
  }
  const cross =
    (mid.x - start.x) * (end.y - mid.y) - (mid.y - start.y) * (end.x - mid.x)

  return {
    center,
    radius: Math.hypot(start.x - center.x, start.y - center.y),
    start_angle_degrees: getArcAngleDegrees(start, center),
    end_angle_degrees: getArcAngleDegrees(end, center),
    direction: cross >= 0 ? "counterclockwise" : "clockwise",
  }
}

const getArcAngleDegrees = (point: Point, center: Point): number => {
  const { x, y } = applyToPoint(SCHEMATIC_ARC_ANGLE_FRAME, {
    x: point.x - center.x,
    y: point.y - center.y,
  })
  return (Math.atan2(y, x) * 180) / Math.PI
}

const normalizeReadableRotation = (rotation: number): number => {
  let normalized = ((rotation % 360) + 360) % 360
  if (normalized > 180) normalized -= 360
  if (normalized > 90) normalized -= 180
  if (normalized < -90) normalized += 180
  return normalized
}
