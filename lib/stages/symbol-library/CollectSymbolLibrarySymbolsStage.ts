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
  SchematicText,
  SourcePort,
  SourceSimpleCapacitor,
  SourceSimpleChip,
  SourceSimpleDiode,
  SourceSimpleInductor,
  SourceSimpleLed,
  SourceSimpleResistor,
  SourceSimpleTransistor,
} from "circuit-json"
import type {
  KicadSymbolLibArc,
  KicadSymbolLibCircle,
  KicadSymbolLibPin,
  KicadSymbolLibPoint,
  KicadSymbolLibPolyline,
  KicadSymbolLibRectangle,
  KicadSymbolLibSymbol,
  KicadSymbolLibText,
} from "../../types"
import { rotationToDirection } from "../schematic/utils/rotationToDirection"

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
  | Omit<SourceSimpleChip, "type" | "source_component_id">
type SymbolLibrarySourceFtype = SymbolLibrarySourceComponentData["ftype"]
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
type SchematicTextData = Omit<SchematicText, "type" | "schematic_text_id">

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
      if (!symbol.name || this.processedSymbols.has(symbol.name)) continue
      this.processSymbol(symbol)
      this.processedSymbols.add(symbol.name)
    }

    this.finished = true
    return false
  }

  private processSymbol(symbol: KicadSymbolLibSymbol) {
    const sourceComponentData = this.createSourceComponentData(symbol)
    const sourceComponent =
      this.ctx.db.source_component.insert(sourceComponentData)

    const pins = this.collectPins(symbol)
    const seenPinNumbers = new Set<string>()
    let unnamedPinIndex = 0
    const sourcePortIdByPinNumber = new Map<string, string>()

    for (const pin of pins) {
      const pinNumber = pin.number || `unnamed_${unnamedPinIndex++}`
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
      sourceComponentId: sourceComponent.source_component_id,
      sourcePortIdByPinNumber,
    })

    if (this.ctx.stats) {
      this.ctx.stats.components = (this.ctx.stats.components || 0) + 1
      this.ctx.stats.pads = (this.ctx.stats.pads || 0) + seenPinNumbers.size
    }
  }

  private getKicadSymbolExportFileName(symbol: KicadSymbolLibSymbol): string {
    return `${symbol.name}_unit1.svg`
  }

  private collectPins(symbol: KicadSymbolLibSymbol): KicadSymbolLibPin[] {
    return [
      ...symbol.pins,
      ...symbol.subSymbols.flatMap((subSymbol) => this.collectPins(subSymbol)),
    ]
  }

  private collectPolylines(
    symbol: KicadSymbolLibSymbol,
  ): KicadSymbolLibPolyline[] {
    return [
      ...symbol.polylines,
      ...symbol.subSymbols.flatMap((subSymbol) =>
        this.collectPolylines(subSymbol),
      ),
    ]
  }

  private collectRectangles(
    symbol: KicadSymbolLibSymbol,
  ): KicadSymbolLibRectangle[] {
    return [
      ...symbol.rectangles,
      ...symbol.subSymbols.flatMap((subSymbol) =>
        this.collectRectangles(subSymbol),
      ),
    ]
  }

  private collectCircles(symbol: KicadSymbolLibSymbol): KicadSymbolLibCircle[] {
    return [
      ...symbol.circles,
      ...symbol.subSymbols.flatMap((subSymbol) =>
        this.collectCircles(subSymbol),
      ),
    ]
  }

  private collectArcs(symbol: KicadSymbolLibSymbol): KicadSymbolLibArc[] {
    return [
      ...symbol.arcs,
      ...symbol.subSymbols.flatMap((subSymbol) => this.collectArcs(subSymbol)),
    ]
  }

  private collectTexts(symbol: KicadSymbolLibSymbol): KicadSymbolLibText[] {
    return [
      ...symbol.texts,
      ...symbol.subSymbols.flatMap((subSymbol) => this.collectTexts(subSymbol)),
    ]
  }

  private createSchematicPreview(params: {
    symbol: KicadSymbolLibSymbol
    pins: KicadSymbolLibPin[]
    sourceComponentId: string
    sourcePortIdByPinNumber: Map<string, string>
  }) {
    const { symbol, pins, sourceComponentId, sourcePortIdByPinNumber } = params
    const bounds = this.getPinBounds(pins)
    const scale = this.getPreviewScale(bounds)
    const size = {
      width: Math.max(1, bounds.width * scale),
      height: Math.max(1, bounds.height * scale),
    }
    const center = this.getPreviewCenter()

    const schematicComponentData: SchematicComponentData = {
      source_component_id: sourceComponentId,
      center,
      size,
      is_box_with_pins: false,
    }
    const schematicComponent = this.ctx.db.schematic_component.insert(
      schematicComponentData,
    )

    for (const pin of pins) {
      if (!pin.at) continue
      const pinNumber = pin.number || ""
      const sourcePortId = sourcePortIdByPinNumber.get(pinNumber)
      if (!sourcePortId) continue

      const schematicPortData: SchematicPortData = {
        schematic_component_id: schematicComponent.schematic_component_id,
        source_port_id: sourcePortId,
        center: this.toSchematicPoint(pin.at, center, scale),
        facing_direction: rotationToDirection(pin.at.angle),
        ...this.getSchematicPortPinMetadata(pinNumber),
      }
      this.ctx.db.schematic_port.insert(schematicPortData)
    }

    this.createPinLinePrimitives({
      pins,
      schematicComponentId: schematicComponent.schematic_component_id,
      origin: center,
      scale,
    })

    this.createSchematicPrimitives({
      symbol,
      schematicComponentId: schematicComponent.schematic_component_id,
      origin: center,
      scale,
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

  private getPinBounds(pins: KicadSymbolLibPin[]): {
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
    symbol: KicadSymbolLibSymbol
    schematicComponentId: string
    origin: Point
    scale: number
  }) {
    const { symbol, schematicComponentId, origin, scale } = params

    for (const polyline of this.collectPolylines(symbol)) {
      this.createPolylinePrimitives(
        polyline,
        schematicComponentId,
        origin,
        scale,
      )
    }

    for (const rectangle of this.collectRectangles(symbol)) {
      const start = this.toSchematicPoint(rectangle.start, origin, scale)
      const end = this.toSchematicPoint(rectangle.end, origin, scale)
      const rectData: SchematicRectData = {
        schematic_component_id: schematicComponentId,
        center: {
          x: (start.x + end.x) / 2,
          y: (start.y + end.y) / 2,
        },
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
        rotation: 0,
        stroke_width: this.toStrokeWidth(rectangle.stroke?.width, scale),
        color: DEFAULT_STROKE_COLOR,
        is_filled: this.isFilled(rectangle.fill?.type),
        fill_color: this.getFillColor(rectangle.fill?.type),
        is_dashed: rectangle.stroke?.type === "dash",
      }
      this.ctx.db.schematic_rect.insert(rectData)
    }

    for (const circle of this.collectCircles(symbol)) {
      const circleData: SchematicCircleData = {
        schematic_component_id: schematicComponentId,
        center: this.toSchematicPoint(circle.center, origin, scale),
        radius: circle.radius * scale,
        stroke_width: this.toStrokeWidth(circle.stroke?.width, scale),
        color: DEFAULT_STROKE_COLOR,
        is_filled: this.isFilled(circle.fill?.type),
        fill_color: this.getFillColor(circle.fill?.type),
        is_dashed: circle.stroke?.type === "dash",
      }
      this.ctx.db.schematic_circle.insert(circleData)
    }

    for (const arc of this.collectArcs(symbol)) {
      const arcGeometry = this.getArcGeometry(arc, origin, scale)
      if (!arcGeometry) {
        const pathData: SchematicPathData = {
          schematic_component_id: schematicComponentId,
          points: [arc.start, arc.mid, arc.end].map((point) =>
            this.toSchematicPoint(point, origin, scale),
          ),
          stroke_width: this.toStrokeWidth(arc.stroke?.width, scale),
          stroke_color: DEFAULT_STROKE_COLOR,
        }
        this.ctx.db.schematic_path.insert(pathData)
        continue
      }

      const arcData: SchematicArcData = {
        schematic_component_id: schematicComponentId,
        ...arcGeometry,
        stroke_width: this.toStrokeWidth(arc.stroke?.width, scale),
        color: DEFAULT_STROKE_COLOR,
        is_dashed: arc.stroke?.type === "dash",
      }
      this.ctx.db.schematic_arc.insert(arcData)
    }

    for (const text of this.collectTexts(symbol)) {
      if (!text.text) continue

      const textData: SchematicTextData = {
        schematic_component_id: schematicComponentId,
        text: text.text,
        font_size: Math.max(0.1, (text.fontSize ?? 1.27) * scale),
        position: this.toSchematicPoint(text.at, origin, scale),
        rotation: -text.at.angle,
        anchor: "center",
        color: DEFAULT_STROKE_COLOR,
      }
      this.ctx.db.schematic_text.insert(textData)
    }
  }

  private createPinLinePrimitives(params: {
    pins: KicadSymbolLibPin[]
    schematicComponentId: string
    origin: Point
    scale: number
  }) {
    const { pins, schematicComponentId, origin, scale } = params

    for (const pin of pins) {
      if (!pin.at || pin.hidden || !pin.length) continue
      if (pin.graphicStyle && pin.graphicStyle !== "line") continue

      const start = this.toSchematicPoint(pin.at, origin, scale)
      const end = this.toSchematicPoint(
        this.getPinLineEndPoint(pin),
        origin,
        scale,
      )
      if (start.x === end.x && start.y === end.y) continue

      const lineData: SchematicLineData = {
        schematic_component_id: schematicComponentId,
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        stroke_width: this.toStrokeWidth(undefined, scale),
        color: DEFAULT_STROKE_COLOR,
        is_dashed: false,
      }
      this.ctx.db.schematic_line.insert(lineData)
    }
  }

  private getPinLineEndPoint(pin: KicadSymbolLibPin): KicadSymbolLibPoint {
    const angleRadians = ((pin.at?.angle ?? 0) * Math.PI) / 180
    const length = pin.length ?? 0

    return {
      x: (pin.at?.x ?? 0) + Math.cos(angleRadians) * length,
      y: (pin.at?.y ?? 0) + Math.sin(angleRadians) * length,
    }
  }

  private createPolylinePrimitives(
    polyline: KicadSymbolLibPolyline,
    schematicComponentId: string,
    origin: Point,
    scale: number,
  ) {
    if (polyline.points.length < 2) return

    if (this.isFilled(polyline.fill?.type) && polyline.points.length >= 3) {
      const pathData: SchematicPathData = {
        schematic_component_id: schematicComponentId,
        points: polyline.points.map((point) =>
          this.toSchematicPoint(point, origin, scale),
        ),
        stroke_width: this.toStrokeWidth(polyline.stroke?.width, scale),
        stroke_color: DEFAULT_STROKE_COLOR,
        is_filled: true,
        fill_color: this.getFillColor(polyline.fill?.type),
      }
      this.ctx.db.schematic_path.insert(pathData)
    }

    for (let index = 1; index < polyline.points.length; index++) {
      const start = this.toSchematicPoint(
        polyline.points[index - 1]!,
        origin,
        scale,
      )
      const end = this.toSchematicPoint(polyline.points[index]!, origin, scale)
      const lineData: SchematicLineData = {
        schematic_component_id: schematicComponentId,
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

  private toSchematicPoint(
    point: KicadSymbolLibPoint,
    origin: Point = { x: 0, y: 0 },
    scale = MAX_KICAD_SYMBOL_UNIT_TO_CJ,
  ): Point {
    return {
      x: origin.x + point.x * scale,
      y: origin.y + point.y * scale,
    }
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

  private getArcGeometry(
    arc: KicadSymbolLibArc,
    origin: Point,
    scale: number,
  ): Pick<
    SchematicArcData,
    | "center"
    | "radius"
    | "start_angle_degrees"
    | "end_angle_degrees"
    | "direction"
  > | null {
    const start = this.toSchematicPoint(arc.start, origin, scale)
    const mid = this.toSchematicPoint(arc.mid, origin, scale)
    const end = this.toSchematicPoint(arc.end, origin, scale)

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
    const startAngleDegrees = this.getAngleDegrees(start, center)
    const endAngleDegrees = this.getAngleDegrees(end, center)
    const cross =
      (mid.x - start.x) * (end.y - mid.y) - (mid.y - start.y) * (end.x - mid.x)

    return {
      center,
      radius,
      start_angle_degrees: startAngleDegrees,
      end_angle_degrees: endAngleDegrees,
      direction: cross >= 0 ? "counterclockwise" : "clockwise",
    }
  }

  private getAngleDegrees(point: Point, center: Point): number {
    return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI
  }

  private getManufacturerPartNumber(
    symbol: KicadSymbolLibSymbol,
  ): string | undefined {
    return (
      symbol.properties["Manufacturer Part Number"] ||
      symbol.properties["MPN"] ||
      symbol.properties["P/N"] ||
      symbol.properties.Value ||
      undefined
    )
  }

  private createSourceComponentData(
    symbol: KicadSymbolLibSymbol,
  ): SymbolLibrarySourceComponentData {
    const base = {
      name: symbol.name,
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
      case "simple_led":
      case "simple_diode":
      case "simple_chip":
        return { ...base, ftype }
    }
  }

  private inferFtype(symbol: KicadSymbolLibSymbol): SymbolLibrarySourceFtype {
    const name = symbol.name.toLowerCase()
    const reference = symbol.properties.Reference ?? ""

    if (name === "r" || name.startsWith("r_") || reference.startsWith("R")) {
      return "simple_resistor"
    }
    if (name === "c" || name.startsWith("c_") || reference.startsWith("C")) {
      return "simple_capacitor"
    }
    if (name === "l" || name.startsWith("l_") || reference.startsWith("L")) {
      return "simple_inductor"
    }
    if (name.includes("led") || reference.startsWith("LED")) {
      return "simple_led"
    }
    if (name.startsWith("d_") || reference.startsWith("D")) {
      return "simple_diode"
    }
    if (name.startsWith("q_") || reference.startsWith("Q")) {
      return "simple_transistor"
    }

    return "simple_chip"
  }

  private getPortName(pin: KicadSymbolLibPin, pinNumber: string): string {
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

  private getSchematicPortPinMetadata(
    pinNumber: string,
  ): Partial<Pick<SchematicPortData, "pin_number" | "display_pin_label">> {
    if (/^\d+$/.test(pinNumber)) {
      return { pin_number: Number(pinNumber) }
    }

    return { display_pin_label: pinNumber }
  }
}
