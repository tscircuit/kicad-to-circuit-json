import { ConverterStage } from "../../types"
import type { KicadSymbolLibPin, KicadSymbolLibSymbol } from "../../types"
import { rotationToDirection } from "../schematic/utils/rotationToDirection"

const KICAD_SYMBOL_UNIT_TO_CJ = 1 / 15
const PREVIEW_COLUMNS = 6
const PREVIEW_CELL_WIDTH = 7
const PREVIEW_CELL_HEIGHT = 10

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

    for (const symbol of this.ctx.kicadSymbolLib.symbols) {
      if (!symbol.name || this.processedSymbols.has(symbol.name)) continue
      this.processSymbol(symbol)
      this.processedSymbols.add(symbol.name)
    }

    this.finished = true
    return false
  }

  private processSymbol(symbol: KicadSymbolLibSymbol) {
    const sourceComponent = this.ctx.db.source_component.insert({
      name: symbol.name,
      ftype: this.inferFtype(symbol) as any,
      manufacturer_part_number: this.getManufacturerPartNumber(symbol),
    } as any)

    const pins = this.collectPins(symbol)
    const seenPinNumbers = new Set<string>()
    let unnamedPinIndex = 0
    const sourcePortIdByPinNumber = new Map<string, string>()

    for (const pin of pins) {
      const pinNumber = pin.number || `unnamed_${unnamedPinIndex++}`
      if (seenPinNumbers.has(pinNumber)) continue
      seenPinNumbers.add(pinNumber)

      const sourcePort = this.ctx.db.source_port.insert({
        source_component_id: sourceComponent.source_component_id,
        name: this.getPortName(pin, pinNumber),
        pin_number: this.getPinNumber(pinNumber),
      } as any)
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

  private collectPins(symbol: KicadSymbolLibSymbol): KicadSymbolLibPin[] {
    return [
      ...symbol.pins,
      ...symbol.subSymbols.flatMap((subSymbol) => this.collectPins(subSymbol)),
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
    const size = {
      width: Math.max(1, bounds.width * KICAD_SYMBOL_UNIT_TO_CJ),
      height: Math.max(1, bounds.height * KICAD_SYMBOL_UNIT_TO_CJ),
    }
    const center = this.getPreviewCenter()

    const schematicComponent = this.ctx.db.schematic_component.insert({
      source_component_id: sourceComponentId,
      center,
      size,
      rotation: 0,
    } as any)

    for (const pin of pins) {
      if (!pin.at) continue
      const pinNumber = pin.number || ""
      const sourcePortId = sourcePortIdByPinNumber.get(pinNumber)
      if (!sourcePortId) continue

      this.ctx.db.schematic_port.insert({
        schematic_component_id: schematicComponent.schematic_component_id,
        source_port_id: sourcePortId,
        center: {
          x: pin.at.x * KICAD_SYMBOL_UNIT_TO_CJ,
          y: -pin.at.y * KICAD_SYMBOL_UNIT_TO_CJ,
        },
        facing_direction: rotationToDirection(pin.at.angle),
        pin_number: this.getPinNumber(pinNumber),
      } as any)
    }
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

  private inferFtype(symbol: KicadSymbolLibSymbol): string {
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

  private getPinNumber(pinNumber: string): number | string {
    if (/^\d+$/.test(pinNumber)) return Number(pinNumber)
    return pinNumber
  }
}
