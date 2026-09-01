import type {
  SchematicArc as CircuitJsonSchematicArc,
  Point,
} from "circuit-json"
import type {
  At,
  GlobalLabel,
  Label,
  Polyline,
  SchematicArc,
  SchematicRectangle,
  SchematicText,
  Sheet,
  TextEffects,
} from "kicadts"
import { applyToPoint } from "transformation-matrix"
import { ConverterStage } from "../../types"

const GRAPHIC_COLOR = "rgb(0, 0, 132)"
const TEXT_COLOR = "rgb(0, 0, 132)"
const LOCAL_LABEL_COLOR = "rgb(15, 15, 15)"
const SHEET_PIN_COLOR = "rgb(0, 100, 100)"
const SHEET_FILE_COLOR = "rgb(132, 0, 0)"
const NO_CONNECT_COLOR = "rgb(0, 0, 132)"

type TextAnchor =
  | "top_left"
  | "top_center"
  | "top_right"
  | "center_left"
  | "center"
  | "center_right"
  | "bottom_left"
  | "bottom_center"
  | "bottom_right"

/** Converts standalone schematic labels, text, sheets, and drawing primitives. */
export class CollectSchematicAnnotationsStage extends ConverterStage {
  private sourceNetIds = new Map<string, string>()

  step(): boolean {
    const { kicadSch, k2cMatSch } = this.ctx
    if (!kicadSch || !k2cMatSch) {
      this.finished = true
      return false
    }

    for (const label of kicadSch.labels) this.processLocalLabel(label)
    for (const label of kicadSch.globalLabels) {
      this.processGlobalLabel(label)
    }
    for (const text of kicadSch.texts) this.processText(text)
    for (const sheet of kicadSch.sheets) this.processSheet(sheet)
    for (const noConnect of kicadSch.noConnects) {
      if (noConnect.at) this.processNoConnect(noConnect.at)
    }
    for (const rectangle of kicadSch.rectangles) {
      this.processRectangle(rectangle)
    }
    for (const polyline of kicadSch.polylines) {
      this.processPolyline(polyline)
    }
    for (const arc of kicadSch.arcs) this.processArc(arc)

    this.finished = true
    return false
  }

  private processLocalLabel(label: Label) {
    if (!this.ctx.k2cMatSch || !label.at || !label.value) return

    const text = decodeKicadText(label.value)
    this.getOrCreateSourceNetId(text)
    this.insertText(text, label.at, label.effects, {
      color: LOCAL_LABEL_COLOR,
    })

    this.incrementLabelCount()
  }

  private processGlobalLabel(label: GlobalLabel) {
    if (!this.ctx.k2cMatSch || !label.at || !label.value) return

    const text = decodeKicadText(label.value)
    const sourceNetId = this.getOrCreateSourceNetId(text)

    const position = applyToPoint(this.ctx.k2cMatSch, label.at)
    this.ctx.db.schematic_net_label.insert({
      source_net_id: sourceNetId,
      center: position,
      anchor_position: position,
      anchor_side: angleToAnchorSide(label.at.angle),
      text,
      is_movable: false,
    })

    this.incrementLabelCount()
  }

  private getOrCreateSourceNetId(text: string): string {
    const existingSourceNetId = this.sourceNetIds.get(text)
    if (existingSourceNetId) return existingSourceNetId

    const sourceNet = this.ctx.db.source_net.insert({
      name: text,
      member_source_group_ids: [],
    } as any)
    this.sourceNetIds.set(text, sourceNet.source_net_id)
    return sourceNet.source_net_id
  }

  private incrementLabelCount() {
    if (this.ctx.stats) {
      this.ctx.stats.labels = (this.ctx.stats.labels || 0) + 1
    }
  }

  private processText(text: SchematicText) {
    if (!text.at || !text.value || text.effects?.hiddenText) return
    this.insertText(text.value, text.at, text.effects)
  }

  private processSheet(sheet: Sheet) {
    if (!this.ctx.k2cMatSch || !sheet.position || !sheet.size) return

    const start = applyToPoint(this.ctx.k2cMatSch, sheet.position)
    const end = applyToPoint(this.ctx.k2cMatSch, {
      x: sheet.position.x + sheet.size.width,
      y: sheet.position.y + sheet.size.height,
    })
    this.ctx.db.schematic_box.insert({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      is_dashed: false,
    })

    for (const property of sheet.properties) {
      if (!property.at || !property.value || property.effects?.hiddenText) {
        continue
      }
      this.insertText(property.value, property.at, property.effects, {
        color:
          property.key === "Sheetname"
            ? SHEET_PIN_COLOR
            : property.key === "Sheetfile"
              ? SHEET_FILE_COLOR
              : TEXT_COLOR,
      })
    }

    for (const pin of sheet.pins) {
      if (!pin.position || !pin.name || pin.effects?.hiddenText) continue
      const fontSize = getFontSize(pin.effects)
      const angleRadians = ((pin.position.angle ?? 0) * Math.PI) / 180
      const position = applyToPoint(this.ctx.k2cMatSch, pin.position)
      const inset = fontSize * Math.abs(this.ctx.k2cMatSch.a) * 1.2
      const pinTextPosition = {
        x: position.x - Math.cos(angleRadians) * inset,
        y: position.y + Math.sin(angleRadians) * inset,
      }
      const inward = {
        x: -Math.cos(angleRadians),
        y: Math.sin(angleRadians),
      }
      const perpendicular = { x: -inward.y, y: inward.x }
      const halfMarkerHeight = fontSize * Math.abs(this.ctx.k2cMatSch.a) * 0.5
      const markerDepth = fontSize * Math.abs(this.ctx.k2cMatSch.a) * (5 / 6)
      this.ctx.db.schematic_path.insert({
        points: [
          {
            x: position.x + perpendicular.x * halfMarkerHeight,
            y: position.y + perpendicular.y * halfMarkerHeight,
          },
          {
            x: position.x + inward.x * markerDepth,
            y: position.y + inward.y * markerDepth,
          },
          {
            x: position.x - perpendicular.x * halfMarkerHeight,
            y: position.y - perpendicular.y * halfMarkerHeight,
          },
        ],
        stroke_width: 0.01,
        stroke_color: SHEET_PIN_COLOR,
        is_dashed: false,
        is_filled: false,
      })
      this.insertText(pin.name, pin.position, pin.effects, {
        color: SHEET_PIN_COLOR,
        position: pinTextPosition,
      })
    }
  }

  private processNoConnect(at: At) {
    if (!this.ctx.k2cMatSch) return

    const center = applyToPoint(this.ctx.k2cMatSch, at)
    const halfSize = 0.04
    this.insertLine(
      { x: center.x - halfSize, y: center.y - halfSize },
      { x: center.x + halfSize, y: center.y + halfSize },
      NO_CONNECT_COLOR,
    )
    this.insertLine(
      { x: center.x - halfSize, y: center.y + halfSize },
      { x: center.x + halfSize, y: center.y - halfSize },
      NO_CONNECT_COLOR,
    )
  }

  private processRectangle(rectangle: SchematicRectangle) {
    if (!this.ctx.k2cMatSch || !rectangle.start || !rectangle.end) return

    const start = applyToPoint(this.ctx.k2cMatSch, rectangle.start)
    const end = applyToPoint(this.ctx.k2cMatSch, rectangle.end)
    const fillType = rectangle.fill?.type
    const isFilled = fillType !== undefined && fillType !== "none"
    this.ctx.db.schematic_rect.insert({
      center: {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      },
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      rotation: 0,
      stroke_width: toStrokeWidth(
        rectangle.stroke?.width,
        this.ctx.k2cMatSch.a,
      ),
      color: GRAPHIC_COLOR,
      is_filled: isFilled,
      fill_color: isFilled ? GRAPHIC_COLOR : undefined,
      is_dashed: isDashed(rectangle.stroke?.type),
    })
  }

  private processPolyline(polyline: Polyline) {
    if (!this.ctx.k2cMatSch) return

    const points =
      polyline.points?.points.flatMap((point) =>
        "x" in point && "y" in point
          ? [applyToPoint(this.ctx.k2cMatSch!, point)]
          : [],
      ) ?? []
    if (points.length < 2) return

    const fillType = polyline.fill?.type
    const isFilled = fillType !== undefined && fillType !== "none"
    this.ctx.db.schematic_path.insert({
      points,
      stroke_width: toStrokeWidth(polyline.stroke?.width, this.ctx.k2cMatSch.a),
      stroke_color: GRAPHIC_COLOR,
      is_dashed: isDashed(polyline.stroke?.type),
      is_filled: isFilled,
      fill_color: isFilled ? GRAPHIC_COLOR : undefined,
    })
  }

  private processArc(arc: SchematicArc) {
    if (!this.ctx.k2cMatSch || !arc.start || !arc.mid || !arc.end) return

    const start = applyToPoint(this.ctx.k2cMatSch, arc.start)
    const mid = applyToPoint(this.ctx.k2cMatSch, arc.mid)
    const end = applyToPoint(this.ctx.k2cMatSch, arc.end)
    const geometry = getArcGeometry(start, mid, end)
    if (!geometry) {
      this.ctx.db.schematic_path.insert({
        points: [start, mid, end],
        stroke_width: toStrokeWidth(arc.stroke?.width, this.ctx.k2cMatSch.a),
        stroke_color: GRAPHIC_COLOR,
        is_dashed: isDashed(arc.stroke?.type),
        is_filled: false,
      })
      return
    }

    this.ctx.db.schematic_arc.insert({
      ...geometry,
      stroke_width: toStrokeWidth(arc.stroke?.width, this.ctx.k2cMatSch.a),
      color: GRAPHIC_COLOR,
      is_dashed: isDashed(arc.stroke?.type),
    })
  }

  private insertText(
    value: string,
    at: At,
    effects?: TextEffects,
    options: { color?: string; position?: Point } = {},
  ) {
    if (!this.ctx.k2cMatSch) return

    this.ctx.db.schematic_text.insert({
      text: decodeKicadText(value),
      font_size: Math.max(
        0.05,
        getFontSize(effects) * Math.abs(this.ctx.k2cMatSch.a),
      ),
      position: options.position ?? applyToPoint(this.ctx.k2cMatSch, at),
      rotation: normalizeReadableRotation(-(at.angle ?? 0)),
      anchor: getTextAnchor(effects),
      color: options.color ?? TEXT_COLOR,
    })
  }

  private insertLine(start: Point, end: Point, color: string) {
    this.ctx.db.schematic_line.insert({
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      stroke_width: null,
      color,
      is_dashed: false,
    })
  }
}

const decodeKicadText = (text: string): string =>
  text.replaceAll("{slash}", "/")

const angleToAnchorSide = (
  angle: number | undefined,
): "top" | "bottom" | "left" | "right" => {
  const normalized = (((angle ?? 0) % 360) + 360) % 360
  if (normalized === 90) return "bottom"
  if (normalized === 180) return "right"
  if (normalized === 270) return "top"
  return "left"
}

const getTextAnchor = (effects: TextEffects | undefined): TextAnchor => {
  const horizontal = effects?.justify?.horizontal ?? "center"
  const vertical = effects?.justify?.vertical ?? "center"
  return `${vertical}_${horizontal}` as TextAnchor
}

const getFontSize = (effects: TextEffects | undefined): number => {
  const rawSize = effects?.font?.size as
    | { height: number; width: number }
    | Array<{ height: number; width: number }>
    | undefined
  const size = Array.isArray(rawSize) ? rawSize[0] : rawSize
  return size ? Math.max(size.height, size.width) : 1.27
}

const toStrokeWidth = (
  width: number | undefined,
  scaleFactor: number,
): number | null =>
  width ? Math.max(0.01, Math.abs(scaleFactor) * width) : null

const isDashed = (strokeType: string | undefined): boolean =>
  strokeType !== undefined && strokeType !== "default" && strokeType !== "solid"

const getArcGeometry = (
  start: Point,
  mid: Point,
  end: Point,
): Pick<
  CircuitJsonSchematicArc,
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
  const startAngle = angleFromCenter(center, start)
  const midAngle = angleFromCenter(center, mid)
  const endAngle = angleFromCenter(center, end)
  const counterclockwiseSweep = normalizeAngle(endAngle - startAngle)
  const midCounterclockwiseSweep = normalizeAngle(midAngle - startAngle)

  return {
    center,
    radius: Math.hypot(start.x - center.x, start.y - center.y),
    start_angle_degrees: startAngle,
    end_angle_degrees: endAngle,
    direction:
      midCounterclockwiseSweep <= counterclockwiseSweep
        ? "counterclockwise"
        : "clockwise",
  }
}

const angleFromCenter = (center: Point, point: Point): number =>
  (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI

const normalizeAngle = (angle: number): number => ((angle % 360) + 360) % 360

const normalizeReadableRotation = (rotation: number): number => {
  let normalized = ((rotation % 360) + 360) % 360
  if (normalized > 180) normalized -= 360
  if (normalized > 90) normalized -= 180
  if (normalized < -90) normalized += 180
  return normalized
}
