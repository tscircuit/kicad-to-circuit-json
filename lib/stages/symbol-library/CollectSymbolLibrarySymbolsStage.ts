import { ConverterStage } from "../../types"
import type {
  Point,
  SchematicArc,
  SchematicCircle,
  SchematicComponent,
  SchematicLine,
  SchematicPath,
  SchematicPort,
  SchematicRect,
  SchematicSymbol as CircuitJsonSchematicSymbol,
  SchematicText,
  SourcePort,
  SourceSimpleCapacitor,
  SourceSimpleChip,
  SourceSimpleDiode,
  SourceSimpleInductor,
  SourceSimpleLed,
  SourceSimplePinHeader,
  SourceSimpleResistor,
  SourceSimpleTestPoint,
  SourceSimpleTransistor,
} from "circuit-json"
import type {
  SchematicSymbol as KicadSchematicSymbol,
  SymbolArc,
  SymbolCircle,
  SymbolPin,
  SymbolPolyline,
  SymbolProperty,
  SymbolRectangle,
  SymbolText,
} from "kicadts"
import {
  applyToPoint,
  compose,
  type Matrix,
  scale,
  translate,
} from "transformation-matrix"
import {
  inferSourceComponentFtype,
  type SupportedSourceComponentFtype,
} from "./infer-source-component-ftype"

import { rotationToDirection } from "../schematic/utils/rotationToDirection"
import { getKicadSymbolArcPoints } from "../../getKicadSymbolArcPoints"

/**
 * circuit-to-svg recomputes an arc's endpoints from its start/end angles in the
 * renderer's screen space (Y-down), while only the arc center is run through the
 * Y-flipping render transform. Measuring our (Y-up) arc angles in this mirrored
 * frame keeps the rendered arc on the correct side. This is intentionally NOT
 * applied to positions: circuit-to-svg already treats Circuit JSON as Y-up and
 * flips Y itself, so flipping positions here would render symbols upside-down.
 */
const SCHEMATIC_ARC_ANGLE_FRAME = scale(1, -1)

const MAX_KICAD_SYMBOL_UNIT_TO_CJ = 1
const PREVIEW_COLUMNS = 6
const PREVIEW_CELL_WIDTH = 10
const PREVIEW_CELL_HEIGHT = 9.5
const PREVIEW_CELL_FILL_RATIO = 0.95
const DEFAULT_STROKE_COLOR = "rgb(132, 0, 0)"
const DEFAULT_FILL_COLOR = "rgb(255, 255, 194)"

type SymbolLibrarySourceComponentData =
  | Omit<SourceSimpleResistor, "type" | "source_component_id">
  | Omit<SourceSimpleCapacitor, "type" | "source_component_id">
  | Omit<SourceSimpleInductor, "type" | "source_component_id">
  | Omit<SourceSimpleLed, "type" | "source_component_id">
  | Omit<SourceSimpleDiode, "type" | "source_component_id">
  | Omit<SourceSimpleTransistor, "type" | "source_component_id">
  | Omit<SourceSimplePinHeader, "type" | "source_component_id">
  | Omit<SourceSimpleTestPoint, "type" | "source_component_id">
  | Omit<SourceSimpleChip, "type" | "source_component_id">
type SymbolLibrarySourceFtype = SupportedSourceComponentFtype
type SourcePortData = Omit<SourcePort, "type" | "source_port_id">
type SchematicComponentData = Omit<
  SchematicComponent,
  "type" | "schematic_component_id"
>
type SchematicPortData = Omit<SchematicPort, "type" | "schematic_port_id">
type SchematicLineData = Omit<SchematicLine, "type" | "schematic_line_id">
type SchematicRectData = Omit<SchematicRect, "type" | "schematic_rect_id">
type SchematicCircleData = Omit<SchematicCircle, "type" | "schematic_circle_id">
type SchematicArcData = Omit<SchematicArc, "type" | "schematic_arc_id">
type SchematicPathData = Omit<SchematicPath, "type" | "schematic_path_id">
type SchematicSymbolData = Omit<
  CircuitJsonSchematicSymbol,
  "type" | "schematic_symbol_id"
>
type SchematicTextData = Omit<SchematicText, "type" | "schematic_text_id">
type KicadSymbolPoint = { x: number; y: number }
type KicadSymbolShapeChild = {
  token: string
  x?: number
  y?: number
  value?: number
  width?: number
  type?: string
}

/**
 * CollectSymbolLibrarySymbolsStage converts KiCad symbol-library definitions
 * into source-level Circuit JSON:
 * - source_component for each top-level library symbol
 * - source_port for each physical pin in the symbol definition
 * - schematic_component and schematic_port preview geometry for snapshots
 */
export class CollectSymbolLibrarySymbolsStage extends ConverterStage {
  private processedSymbols = new Set<string>()
  private previewIndex = 0

  step(): boolean {
    if (!this.ctx.kicadSymbolLib) {
      this.finished = true
      return false
    }

    const symbols = [...this.ctx.kicadSymbolLib.symbols].sort((a, b) => {
      const aFileName = this.getKicadSymbolExportFileName(a)
      const bFileName = this.getKicadSymbolExportFileName(b)
      return aFileName < bFileName ? -1 : aFileName > bFileName ? 1 : 0
    })

    for (const symbol of symbols) {
      const symbolName = this.getSymbolName(symbol)
      if (!symbolName || this.processedSymbols.has(symbolName)) continue
      this.processSymbol(symbol)
      this.processedSymbols.add(symbolName)
    }

    this.finished = true
    return false
  }

  private processSymbol(symbol: KicadSchematicSymbol) {
    const pins = this.collectPins(symbol)

    const schematicSymbolData: SchematicSymbolData = {
      name: this.getSymbolName(symbol),
    }
    const schematicSymbol =
      this.ctx.db.schematic_symbol.insert(schematicSymbolData)

    const sourceComponentData = this.createSourceComponentData(symbol, pins)
    const sourceComponent =
      this.ctx.db.source_component.insert(sourceComponentData)

    const seenPinNumbers = new Set<string>()
    let unnamedPinIndex = 0
    const sourcePortIdByPinNumber = new Map<string, string>()

    for (const pin of pins) {
      const pinNumber = pin.numberString || `unnamed_${unnamedPinIndex++}`
      if (seenPinNumbers.has(pinNumber)) continue
      seenPinNumbers.add(pinNumber)

      const sourcePortData: SourcePortData = {
        source_component_id: sourceComponent.source_component_id,
        name: this.getPortName(pin, pinNumber),
        ...this.getSourcePortPinMetadata(pinNumber),
      }
      const sourcePort = this.ctx.db.source_port.insert(sourcePortData)
      sourcePortIdByPinNumber.set(pinNumber, sourcePort.source_port_id)
    }

    this.createSchematicPreview({
      symbol,
      pins,
      schematicSymbolId: schematicSymbol.schematic_symbol_id,
      sourceComponentId: sourceComponent.source_component_id,
      sourcePortIdByPinNumber,
    })

    if (this.ctx.stats) {
      this.ctx.stats.components = (this.ctx.stats.components || 0) + 1
      this.ctx.stats.pads = (this.ctx.stats.pads || 0) + seenPinNumbers.size
    }
  }

  private getKicadSymbolExportFileName(symbol: KicadSchematicSymbol): string {
    return `${this.getSymbolName(symbol)}_unit1.svg`
  }

  private getSymbolName(symbol: KicadSchematicSymbol): string {
    return symbol.libraryId ?? symbol.libraryName ?? ""
  }

  private getSymbolProperties(
    symbol: KicadSchematicSymbol,
  ): Record<string, string> {
    return Object.fromEntries(
      symbol.properties.map((property) => [property.key, property.value]),
    )
  }

  private collectPins(symbol: KicadSchematicSymbol): SymbolPin[] {
    return [
      ...symbol.pins,
      ...symbol.subSymbols.flatMap((subSymbol) => this.collectPins(subSymbol)),
    ]
  }

  private collectPolylines(symbol: KicadSchematicSymbol): SymbolPolyline[] {
    return [
      ...symbol.polylines,
      ...symbol.subSymbols.flatMap((subSymbol) =>
        this.collectPolylines(subSymbol),
      ),
    ]
  }

  private collectRectangles(symbol: KicadSchematicSymbol): SymbolRectangle[] {
    return [
      ...symbol.rectangles,
      ...symbol.subSymbols.flatMap((subSymbol) =>
        this.collectRectangles(subSymbol),
      ),
    ]
  }

  private collectCircles(symbol: KicadSchematicSymbol): SymbolCircle[] {
    return [
      ...symbol.circles,
      ...symbol.subSymbols.flatMap((subSymbol) =>
        this.collectCircles(subSymbol),
      ),
    ]
  }

  private collectArcs(symbol: KicadSchematicSymbol): SymbolArc[] {
    return [
      ...symbol.arcs,
      ...symbol.subSymbols.flatMap((subSymbol) => this.collectArcs(subSymbol)),
    ]
  }

  private collectTexts(symbol: KicadSchematicSymbol): SymbolText[] {
    return [
      ...symbol.texts,
      ...symbol.subSymbols.flatMap((subSymbol) => this.collectTexts(subSymbol)),
    ]
  }

  private createSchematicPreview(params: {
    symbol: KicadSchematicSymbol
    pins: SymbolPin[]
    schematicSymbolId: string
    sourceComponentId: string
    sourcePortIdByPinNumber: Map<string, string>
  }) {
    const {
      symbol,
      pins,
      schematicSymbolId,
      sourceComponentId,
      sourcePortIdByPinNumber,
    } = params
    const bounds = this.getPinBounds(pins)
    const origin = this.getPreviewCenter()
    // Single matrix that maps KiCad symbol coordinates into schematic space
    // (uniform scale + translate, no Y flip — KiCad symbol space is already
    // Y-up like Circuit JSON). Threaded through every geometry helper so the
    // coordinate conversion lives in one place.
    const transform = compose(
      translate(origin.x, origin.y),
      scale(this.getPreviewScale(bounds)),
    )
    const bodyBox = this.getBodyBox({ symbol, transform })

    const schematicComponentData: SchematicComponentData = {
      source_component_id: sourceComponentId,
      schematic_symbol_id: schematicSymbolId,
      // When the symbol has a body rectangle, hand its bounds to circuit-to-svg
      // as the component box. circuit-to-svg fills that box (with the same
      // body/outline colors KiCad uses) and paints it beneath the pin
      // lines/labels, so the body never covers the pin names. Symbols without a
      // body rectangle (e.g. passives) keep a zero-size box and rely solely on
      // their imported primitives.
      center: bodyBox?.center ?? origin,
      size: bodyBox
        ? { width: bodyBox.width, height: bodyBox.height }
        : { width: 0, height: 0 },
      is_box_with_pins: true,
      symbol_display_value:
        this.getSymbolProperties(symbol).Value || this.getSymbolName(symbol),
    }
    const schematicComponent = this.ctx.db.schematic_component.insert(
      schematicComponentData,
    )

    // KiCad symbols can hide pin names at the symbol level (e.g. connectors
    // whose pins are all named "Pin_N"); when hidden, the names must not be
    // drawn or they overlap the closely-stacked pins.
    const pinNamesHidden = symbol.pinNames?.hide === true

    for (const pin of pins) {
      if (!pin.at) continue
      const pinNumber = pin.numberString || ""
      const sourcePortId = sourcePortIdByPinNumber.get(pinNumber)
      if (!sourcePortId) continue

      const schematicPortData: SchematicPortData = {
        schematic_component_id: schematicComponent.schematic_component_id,
        source_port_id: sourcePortId,
        center: applyToPoint(transform, { x: pin.at.x, y: pin.at.y }),
        facing_direction: rotationToDirection(pin.at.angle ?? 0),
        ...this.getSchematicPortPinMetadata({
          pin,
          pinNumber,
          transform,
          pinNamesHidden,
        }),
      }
      this.ctx.db.schematic_port.insert(schematicPortData)
    }

    this.createSchematicPrimitives({
      symbol,
      schematicComponentId: schematicComponent.schematic_component_id,
      schematicSymbolId,
      transform,
    })

    this.createPropertyTextPrimitives({
      symbol,
      schematicComponentId: schematicComponent.schematic_component_id,
      schematicSymbolId,
      transform,
    })
  }

  private getPreviewCenter() {
    const index = this.previewIndex++
    const column = index % PREVIEW_COLUMNS
    const row = Math.floor(index / PREVIEW_COLUMNS)

    return {
      x: (column - (PREVIEW_COLUMNS - 1) / 2) * PREVIEW_CELL_WIDTH,
      y: -row * PREVIEW_CELL_HEIGHT,
    }
  }

  private getPinBounds(pins: SymbolPin[]): {
    width: number
    height: number
  } {
    const pinsWithPositions = pins.filter((pin) => pin.at)
    if (pinsWithPositions.length === 0) {
      return { width: 15, height: 15 }
    }

    const xs = pinsWithPositions.map((pin) => pin.at!.x)
    const ys = pinsWithPositions.map((pin) => pin.at!.y)

    return {
      width: Math.max(...xs) - Math.min(...xs) + 7.5,
      height: Math.max(...ys) - Math.min(...ys) + 7.5,
    }
  }

  private getPreviewScale(bounds: { width: number; height: number }): number {
    const scaleX =
      (PREVIEW_CELL_WIDTH * PREVIEW_CELL_FILL_RATIO) / Math.max(1, bounds.width)
    const scaleY =
      (PREVIEW_CELL_HEIGHT * PREVIEW_CELL_FILL_RATIO) /
      Math.max(1, bounds.height)

    return Math.min(MAX_KICAD_SYMBOL_UNIT_TO_CJ, scaleX, scaleY)
  }

  private createSchematicPrimitives(params: {
    symbol: KicadSchematicSymbol
    schematicComponentId: string
    schematicSymbolId: string
    transform: Matrix
  }) {
    const { symbol, schematicComponentId, schematicSymbolId, transform } =
      params
    const scale = this.scaleOf(transform)

    for (const polyline of this.collectPolylines(symbol)) {
      this.createPolylinePrimitives({
        polyline,
        schematicComponentId,
        schematicSymbolId,
        transform,
      })
    }

    for (const rectangle of this.collectRectangles(symbol)) {
      // The background-filled body rectangle is rendered by circuit-to-svg as
      // the component box (see createSchematicPreview), so it is not emitted as
      // a primitive here.
      if (this.getShapeFillType(rectangle) === "background") continue

      const startPoint = this.getShapePoint(rectangle, "start")
      const endPoint = this.getShapePoint(rectangle, "end")
      if (!startPoint || !endPoint) continue

      const start = applyToPoint(transform, startPoint)
      const end = applyToPoint(transform, endPoint)
      const rectData: SchematicRectData = {
        schematic_component_id: schematicComponentId,
        schematic_symbol_id: schematicSymbolId,
        center: {
          x: (start.x + end.x) / 2,
          y: (start.y + end.y) / 2,
        },
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
        rotation: 0,
        stroke_width: this.toStrokeWidth(
          this.getShapeStroke(rectangle)?.width,
          scale,
        ),
        color: DEFAULT_STROKE_COLOR,
        is_filled: this.isFilled(this.getShapeFillType(rectangle)),
        fill_color: this.getFillColor(this.getShapeFillType(rectangle)),
        is_dashed: this.getShapeStroke(rectangle)?.type === "dash",
      }
      this.ctx.db.schematic_rect.insert(rectData)
    }

    for (const circle of this.collectCircles(symbol)) {
      const center = this.getShapePoint(circle, "center")
      const radius = this.getShapeNumber(circle, "radius")
      if (!center || radius === undefined) continue

      const circleData: SchematicCircleData = {
        schematic_component_id: schematicComponentId,
        schematic_symbol_id: schematicSymbolId,
        center: applyToPoint(transform, center),
        radius: radius * scale,
        stroke_width: this.toStrokeWidth(
          this.getShapeStroke(circle)?.width,
          scale,
        ),
        color: DEFAULT_STROKE_COLOR,
        is_filled: this.isFilled(this.getShapeFillType(circle)),
        fill_color: this.getFillColor(this.getShapeFillType(circle)),
        is_dashed: this.getShapeStroke(circle)?.type === "dash",
      }
      this.ctx.db.schematic_circle.insert(circleData)
    }

    for (const arc of this.collectArcs(symbol)) {
      const arcPoints = this.getArcPoints(arc)
      if (!arcPoints) continue

      const arcGeometry = this.getArcGeometry({ arc, transform })
      if (!arcGeometry) {
        const pathData: SchematicPathData = {
          schematic_component_id: schematicComponentId,
          schematic_symbol_id: schematicSymbolId,
          points: [arcPoints.start, arcPoints.mid, arcPoints.end].map((point) =>
            applyToPoint(transform, point),
          ),
          stroke_width: this.toStrokeWidth(
            this.getShapeStroke(arc)?.width,
            scale,
          ),
          stroke_color: DEFAULT_STROKE_COLOR,
          is_dashed: this.getShapeStroke(arc)?.type === "dash",
        }
        this.ctx.db.schematic_path.insert(pathData)
        continue
      }

      const arcData: SchematicArcData = {
        schematic_component_id: schematicComponentId,
        schematic_symbol_id: schematicSymbolId,
        ...arcGeometry,
        stroke_width: this.toStrokeWidth(
          this.getShapeStroke(arc)?.width,
          scale,
        ),
        color: DEFAULT_STROKE_COLOR,
        is_dashed: this.getShapeStroke(arc)?.type === "dash",
      }
      this.ctx.db.schematic_arc.insert(arcData)
    }

    for (const text of this.collectTexts(symbol)) {
      if (!text.value) continue

      const textData: SchematicTextData = {
        schematic_component_id: schematicComponentId,
        schematic_symbol_id: schematicSymbolId,
        text: text.value,
        font_size: Math.max(0.1, this.getFontSize(text.effects) * scale),
        position: applyToPoint(transform, text.at ?? { x: 0, y: 0 }),
        rotation: -(text.at?.angle ?? 0),
        anchor: "center",
        color: DEFAULT_STROKE_COLOR,
      }
      this.ctx.db.schematic_text.insert(textData)
    }
  }

  private createPropertyTextPrimitives(params: {
    symbol: KicadSchematicSymbol
    schematicComponentId: string
    schematicSymbolId: string
    transform: Matrix
  }) {
    const { symbol, schematicComponentId, schematicSymbolId, transform } =
      params
    const scale = this.scaleOf(transform)

    for (const property of symbol.properties) {
      if (property.hidden || !property.value) continue
      if (!this.shouldRenderProperty(property)) continue

      const textData: SchematicTextData = {
        schematic_component_id: schematicComponentId,
        schematic_symbol_id: schematicSymbolId,
        text: property.value,
        font_size: Math.max(0.1, this.getFontSize(property.effects) * scale),
        position: applyToPoint(transform, property.at ?? { x: 0, y: 0 }),
        rotation: -(property.at?.angle ?? 0),
        anchor: this.getTextAnchor(property.effects?.justify?.horizontal),
        color: DEFAULT_STROKE_COLOR,
      }
      this.ctx.db.schematic_text.insert(textData)
    }
  }

  private shouldRenderProperty(property: SymbolProperty): boolean {
    return property.key === "Reference" || property.key === "Value"
  }

  private getTextAnchor(
    justify: "left" | "right" | undefined,
  ): SchematicTextData["anchor"] {
    if (justify === "left") return "left"
    if (justify === "right") return "right"
    return "center"
  }

  private createPolylinePrimitives(params: {
    polyline: SymbolPolyline
    schematicComponentId: string
    schematicSymbolId: string
    transform: Matrix
  }) {
    const { polyline, schematicComponentId, schematicSymbolId, transform } =
      params
    const scale = this.scaleOf(transform)
    const points = this.getPolylinePoints(polyline)
    if (points.length < 2) return

    if (this.isFilled(polyline.fill?.type) && points.length >= 3) {
      const pathData: SchematicPathData = {
        schematic_component_id: schematicComponentId,
        schematic_symbol_id: schematicSymbolId,
        points: points.map((point) => applyToPoint(transform, point)),
        stroke_width: this.toStrokeWidth(polyline.stroke?.width, scale),
        stroke_color: DEFAULT_STROKE_COLOR,
        is_dashed: polyline.stroke?.type === "dash",
        is_filled: true,
        fill_color: this.getFillColor(polyline.fill?.type),
      }
      this.ctx.db.schematic_path.insert(pathData)
    }

    for (let index = 1; index < points.length; index++) {
      const start = applyToPoint(transform, points[index - 1]!)
      const end = applyToPoint(transform, points[index]!)
      const lineData: SchematicLineData = {
        schematic_component_id: schematicComponentId,
        schematic_symbol_id: schematicSymbolId,
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        stroke_width: this.toStrokeWidth(polyline.stroke?.width, scale),
        color: DEFAULT_STROKE_COLOR,
        is_dashed: polyline.stroke?.type === "dash",
      }
      this.ctx.db.schematic_line.insert(lineData)
    }
  }

  /**
   * Uniform scale factor of a symbol→schematic transform, used to scale
   * radii, pin lengths, font sizes and stroke widths that aren't points.
   */
  private scaleOf(transform: Matrix): number {
    return Math.hypot(transform.a, transform.b)
  }

  private toStrokeWidth(
    width: number | undefined,
    scale: number,
  ): number | null {
    if (!width) return null
    return Math.max(0.01, width * scale)
  }

  private isFilled(fillType: string | undefined): boolean {
    return fillType !== undefined && fillType !== "none"
  }

  private getFillColor(fillType: string | undefined): string | undefined {
    if (!this.isFilled(fillType)) return undefined
    return fillType === "background" ? DEFAULT_FILL_COLOR : DEFAULT_STROKE_COLOR
  }

  /**
   * Returns the schematic-space bounds of the symbol's body rectangle (the
   * single KiCad "background"-filled rectangle) so it can be used as the
   * schematic_component box. Returns null for symbols without a body rectangle.
   */
  private getBodyBox(params: {
    symbol: KicadSchematicSymbol
    transform: Matrix
  }): { center: Point; width: number; height: number } | null {
    const { symbol, transform } = params
    for (const rectangle of this.collectRectangles(symbol)) {
      if (this.getShapeFillType(rectangle) !== "background") continue

      const startPoint = this.getShapePoint(rectangle, "start")
      const endPoint = this.getShapePoint(rectangle, "end")
      if (!startPoint || !endPoint) continue

      const start = applyToPoint(transform, startPoint)
      const end = applyToPoint(transform, endPoint)
      return {
        center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      }
    }
    return null
  }

  private getFontSize(
    effects:
      | { font?: { size?: { height: number; width: number } } }
      | undefined,
  ): number {
    const size = effects?.font?.size
    return size ? Math.max(size.height, size.width) : 1.27
  }

  private getPolylinePoints(polyline: SymbolPolyline): KicadSymbolPoint[] {
    return (
      polyline.points?.points.flatMap((point) =>
        "x" in point && "y" in point ? [{ x: point.x, y: point.y }] : [],
      ) ?? []
    )
  }

  private getShapeChildren(shape: { getChildren(): unknown[] }) {
    return shape.getChildren() as KicadSymbolShapeChild[]
  }

  private getShapeChild(
    shape: { getChildren(): unknown[] },
    token: string,
  ): KicadSymbolShapeChild | undefined {
    return this.getShapeChildren(shape).find((child) => child.token === token)
  }

  private getShapePoint(
    shape: { getChildren(): unknown[] },
    token: string,
  ): KicadSymbolPoint | undefined {
    const child = this.getShapeChild(shape, token)
    if (child?.x === undefined || child.y === undefined) return undefined
    return { x: child.x, y: child.y }
  }

  private getShapeNumber(
    shape: { getChildren(): unknown[] },
    token: string,
  ): number | undefined {
    return this.getShapeChild(shape, token)?.value
  }

  private getShapeStroke(shape: {
    getChildren(): unknown[]
  }): { width?: number; type?: string } | undefined {
    return this.getShapeChild(shape, "stroke")
  }

  private getShapeFillType(shape: { getChildren(): unknown[] }) {
    return this.getShapeChild(shape, "fill")?.type
  }

  private getArcPoints(arc: SymbolArc): {
    start: KicadSymbolPoint
    mid: KicadSymbolPoint
    end: KicadSymbolPoint
  } | null {
    return getKicadSymbolArcPoints(arc)
  }

  private getArcGeometry(params: {
    arc: SymbolArc
    transform: Matrix
  }): Pick<
    SchematicArcData,
    | "center"
    | "radius"
    | "start_angle_degrees"
    | "end_angle_degrees"
    | "direction"
  > | null {
    const { arc, transform } = params
    const arcPoints = this.getArcPoints(arc)
    if (!arcPoints) return null

    const start = applyToPoint(transform, arcPoints.start)
    const mid = applyToPoint(transform, arcPoints.mid)
    const end = applyToPoint(transform, arcPoints.end)

    const denominator =
      2 *
      (start.x * (mid.y - end.y) +
        mid.x * (end.y - start.y) +
        end.x * (start.y - mid.y))

    if (Math.abs(denominator) < 1e-9) return null

    const startLen = start.x ** 2 + start.y ** 2
    const midLen = mid.x ** 2 + mid.y ** 2
    const endLen = end.x ** 2 + end.y ** 2
    const center = {
      x:
        (startLen * (mid.y - end.y) +
          midLen * (end.y - start.y) +
          endLen * (start.y - mid.y)) /
        denominator,
      y:
        (startLen * (end.x - mid.x) +
          midLen * (start.x - end.x) +
          endLen * (mid.x - start.x)) /
        denominator,
    }

    const radius = Math.hypot(start.x - center.x, start.y - center.y)
    const cross =
      (mid.x - start.x) * (end.y - mid.y) - (mid.y - start.y) * (end.x - mid.x)

    // Angles are measured in circuit-to-svg's arc-angle frame (see
    // SCHEMATIC_ARC_ANGLE_FRAME). The cross-product direction is already in the
    // convention circuit-to-svg expects, so it is left as-is.
    return {
      center,
      radius,
      start_angle_degrees: this.getArcAngleDegrees(start, center),
      end_angle_degrees: this.getArcAngleDegrees(end, center),
      direction: cross >= 0 ? "counterclockwise" : "clockwise",
    }
  }

  private getArcAngleDegrees(point: Point, center: Point): number {
    const { x, y } = applyToPoint(SCHEMATIC_ARC_ANGLE_FRAME, {
      x: point.x - center.x,
      y: point.y - center.y,
    })
    return (Math.atan2(y, x) * 180) / Math.PI
  }

  private getManufacturerPartNumber(
    symbol: KicadSchematicSymbol,
  ): string | undefined {
    const properties = this.getSymbolProperties(symbol)
    return (
      properties["Manufacturer Part Number"] ||
      properties["MPN"] ||
      properties["P/N"] ||
      properties.Value ||
      undefined
    )
  }

  private createSourceComponentData(
    symbol: KicadSchematicSymbol,
    pins: SymbolPin[],
  ): SymbolLibrarySourceComponentData {
    const base = {
      name: this.getSymbolName(symbol),
      manufacturer_part_number: this.getManufacturerPartNumber(symbol),
    }
    const ftype = this.inferFtype(symbol)

    switch (ftype) {
      case "simple_resistor":
        return { ...base, ftype, resistance: 0 }
      case "simple_capacitor":
        return { ...base, ftype, capacitance: 0 }
      case "simple_inductor":
        return { ...base, ftype, inductance: 0 }
      case "simple_transistor":
        return { ...base, ftype, transistor_type: "npn" }
      case "simple_pin_header":
        return {
          ...base,
          ftype,
          pin_count:
            this.getUniquePinCount(pins) ||
            this.inferPinHeaderPinCountFromName(symbol) ||
            1,
          gender: this.inferPinHeaderGender(symbol),
        }
      case "simple_test_point":
      case "simple_led":
      case "simple_diode":
      case "simple_chip":
        return { ...base, ftype }
    }

    const exhaustiveCheck: never = ftype
    throw new Error(`Unsupported source component ftype: ${exhaustiveCheck}`)
  }

  private inferFtype(symbol: KicadSchematicSymbol): SymbolLibrarySourceFtype {
    return inferSourceComponentFtype({
      name: this.getSymbolName(symbol),
      reference: this.getSymbolProperties(symbol).Reference ?? "",
      metadata: this.getSymbolMetadataText(symbol),
    })
  }

  private getSymbolMetadataText(symbol: KicadSchematicSymbol): string {
    return Object.values(this.getSymbolProperties(symbol)).join(" ")
  }

  private getUniquePinCount(pins: SymbolPin[]): number {
    return this.countUniquePinIdentifiers(
      pins.map((pin) => pin.numberString || pin._sxNumber?.value),
    )
  }

  private countUniquePinIdentifiers(
    identifiers: Array<string | number | undefined | null>,
  ): number {
    return new Set(
      identifiers
        .map((identifier) => `${identifier ?? ""}`.trim())
        .filter(Boolean),
    ).size
  }

  private inferPinHeaderGender(
    symbol: KicadSchematicSymbol,
  ): "male" | "female" {
    const combined =
      `${this.getSymbolName(symbol)} ${this.getSymbolMetadataText(symbol)}`.toLowerCase()

    if (
      combined.includes("socket") ||
      combined.includes("female") ||
      combined.includes("pinsocket")
    ) {
      return "female"
    }

    return "male"
  }

  private inferPinHeaderPinCountFromName(
    symbol: KicadSchematicSymbol,
  ): number | undefined {
    const name = this.getSymbolName(symbol)
    if (!name) return undefined

    const match = name.match(/(?:pin(?:header|socket)|conn)_(\d+)x(\d+)/i)
    if (!match) return undefined

    const rows = Number.parseInt(match[1]!, 10)
    const columns = Number.parseInt(match[2]!, 10)

    if (!Number.isFinite(rows) || !Number.isFinite(columns)) return undefined

    return rows * columns
  }

  private getPortName(pin: SymbolPin, pinNumber: string): string {
    if (pin.name) return pin.name
    if (/^\d+$/.test(pinNumber)) return `pin${Number(pinNumber)}`
    return pinNumber
  }

  private getSourcePortPinMetadata(
    pinNumber: string,
  ): Partial<Pick<SourcePortData, "pin_number" | "port_hints">> {
    if (/^\d+$/.test(pinNumber)) {
      return { pin_number: Number(pinNumber) }
    }

    return { port_hints: [pinNumber] }
  }

  private getSchematicPortPinMetadata(params: {
    pin: SymbolPin
    pinNumber: string
    transform: Matrix
    pinNamesHidden: boolean
  }): Partial<
    Pick<
      SchematicPortData,
      | "pin_number"
      | "display_pin_label"
      | "side_of_component"
      | "distance_from_component_edge"
    >
  > {
    const { pin, pinNumber, transform, pinNamesHidden } = params
    const scale = this.scaleOf(transform)
    const metadata: Partial<
      Pick<
        SchematicPortData,
        | "pin_number"
        | "display_pin_label"
        | "side_of_component"
        | "distance_from_component_edge"
      >
    > = {}

    if (/^\d+$/.test(pinNumber)) {
      metadata.pin_number = Number(pinNumber)
    } else {
      metadata.display_pin_label = pinNumber
    }

    if (pin.name && !pinNamesHidden) {
      metadata.display_pin_label = pin.name
    }

    if (!pin.hidden && pin.length && pin.length > 0) {
      metadata.side_of_component = this.pinAngleToSideOfComponent(
        pin.at?.angle ?? 0,
      )
      metadata.distance_from_component_edge = pin.length * scale
    }

    return metadata
  }

  private pinAngleToSideOfComponent(
    angle: number,
  ): NonNullable<SchematicPortData["side_of_component"]> {
    const normalized = ((angle % 360) + 360) % 360

    if (normalized >= 315 || normalized < 45) return "left"
    if (normalized >= 45 && normalized < 135) return "bottom"
    if (normalized >= 135 && normalized < 225) return "right"
    return "top"
  }
}
