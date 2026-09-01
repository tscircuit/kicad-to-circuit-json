import { ConverterStage } from "../../types"
import { applyToPoint } from "transformation-matrix"
import type { SchematicSymbol, SymbolPin } from "kicadts"
import {
  inferSourceComponentFtype,
  type SupportedSourceComponentFtype,
} from "../symbol-library/infer-source-component-ftype"
import { inferSymbolName } from "./utils/inferSymbolName"
import { rotationToDirection } from "./utils/rotationToDirection"

/**
 * CollectLibrarySymbolsStage extracts KiCad schematic symbols and creates:
 * - source_component entries (with ftype inferred from library id)
 * - schematic_component entries with positions
 * - schematic_port entries for each pin
 */
export class CollectLibrarySymbolsStage extends ConverterStage {
  private processedSymbols = new Set<string>()

  step(): boolean {
    if (!this.ctx.kicadSch || !this.ctx.k2cMatSch) {
      this.finished = true
      return false
    }

    const symbols = this.ctx.kicadSch.symbols || []

    for (const symbol of symbols) {
      const uuid = symbol.uuid
      if (!uuid || this.processedSymbols.has(uuid)) continue

      this.processSymbol(symbol)
      this.processedSymbols.add(uuid)
    }

    this.finished = true
    return false
  }

  private processSymbol(symbol: SchematicSymbol) {
    if (!this.ctx.k2cMatSch) return

    // Get symbol properties
    const reference = this.getProperty(symbol, "Reference") || "U?"
    const value = this.getProperty(symbol, "Value") || ""
    const libId = symbol.libraryId || ""

    // Transform position from KiCad to CJ coordinates
    const at = symbol.at
    const kicadPos = { x: at?.x ?? 0, y: at?.y ?? 0 }
    const cjPos = applyToPoint(this.ctx.k2cMatSch, kicadPos)

    const rotation = at?.angle ?? 0
    // Infer component type from library id
    const ftype = this.inferFtype(libId, reference)

    const sourceComponent = this.ctx.db.source_component.insert({
      name: libId || reference,
      ftype,
      manufacturer_part_number: value || undefined,
    })

    // Create schematic_component
    const uuid = symbol.uuid
    if (!uuid) return

    const symbolName = inferSymbolName({ libId, reference, rotation })

    const inserted = this.ctx.db.schematic_component.insert({
      source_component_id: sourceComponent.source_component_id,
      center: { x: cjPos.x, y: cjPos.y },
      size: this.estimateSize(symbol),
      ...(symbolName ? { symbol_name: symbolName } : {}),
    } as any)

    const componentId = inserted.schematic_component_id

    // Map uuid to component id for later reference
    this.ctx.symbolUuidToComponentId?.set(uuid, componentId)

    // Create ports for pins
    this.createPorts(symbol, componentId, cjPos)

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.components = (this.ctx.stats.components || 0) + 1
    }
  }

  private getProperty(
    symbol: SchematicSymbol,
    propName: string,
  ): string | undefined {
    const props = symbol.properties || []
    const prop = props.find((p: any) => p.key === propName)
    return prop?.value
  }

  private inferFtype(
    libId: string,
    reference: string,
  ): SupportedSourceComponentFtype {
    return inferSourceComponentFtype({
      name: libId,
      reference,
    })
  }

  private estimateSize(symbol: SchematicSymbol): {
    width: number
    height: number
  } {
    // For MVP, use a default size
    // In a more complete implementation, we would parse the symbol's graphical primitives
    // or derive from pin extents
    return { width: 1, height: 1 }
  }

  private createPorts(
    symbol: SchematicSymbol,
    componentId: string,
    componentCenter: { x: number; y: number },
  ) {
    // Get the library symbol definition to find pin information
    const libId = symbol.libraryId
    const libSymbol = this.ctx.kicadSch?.libSymbols?.symbols?.find(
      (ls: any) => ls.libraryId === libId,
    )

    if (!libSymbol) return

    const allPins = this.getPinsForSymbolUnit(libSymbol, symbol)

    if (allPins.length === 0) return

    // Get component rotation
    const componentRotation = symbol.at?.angle ?? 0

    for (const pin of allPins) {
      // Transform pin position from KiCad to circuit-json coordinates
      // Pin position in KiCad is relative to symbol origin
      const pinAt = pin.at
      if (!pinAt) continue

      const mirroredPinPos = {
        x: symbol.mirror === "y" ? -pinAt.x : pinAt.x,
        y: symbol.mirror === "x" ? -pinAt.y : pinAt.y,
      }

      // Apply component rotation to pin position (rotate around origin)
      const rotRad = (componentRotation * Math.PI) / 180
      const cosR = Math.cos(rotRad)
      const sinR = Math.sin(rotRad)

      const rotatedPinPos = {
        x: mirroredPinPos.x * cosR - mirroredPinPos.y * sinR,
        y: mirroredPinPos.x * sinR + mirroredPinPos.y * cosR,
      }

      // Transform to circuit-json space scale (k2cMatSch just scales, doesn't rotate)
      const scaleFactor = Math.abs(this.ctx.k2cMatSch?.a || 1 / 15)
      const portCenter = {
        x: componentCenter.x + rotatedPinPos.x * scaleFactor,
        y: componentCenter.y - rotatedPinPos.y * scaleFactor,
      }
      const pinNumber = Number(pin.numberString)

      this.ctx.db.schematic_port.insert({
        schematic_component_id: componentId,
        center: portCenter,
        facing_direction: this.inferPinDirection(pin, componentRotation),
        pin_number: Number.isFinite(pinNumber) ? pinNumber : undefined,
      } as any)
    }
  }

  private getPinsForSymbolUnit(
    libSymbol: SchematicSymbol,
    symbol: SchematicSymbol,
  ): SymbolPin[] {
    const unit = symbol.unit ?? 1
    const bodyStyle = symbol.bodyStyle ?? 1
    const applicableSubSymbols = libSymbol.subSymbols.filter((subSymbol) => {
      const unitAndBodyStyle = subSymbol.libraryId?.match(/_(\d+)_(\d+)$/)
      if (!unitAndBodyStyle) return true

      const subSymbolUnit = Number(unitAndBodyStyle[1])
      const subSymbolBodyStyle = Number(unitAndBodyStyle[2])

      return (
        (subSymbolUnit === 0 || subSymbolUnit === unit) &&
        (subSymbolBodyStyle === 0 || subSymbolBodyStyle === bodyStyle)
      )
    })

    return [
      ...libSymbol.pins,
      ...applicableSubSymbols.flatMap((subSymbol) => subSymbol.pins),
    ]
  }

  private inferPinDirection(
    pin: SymbolPin,
    componentRotation: number,
  ): "up" | "down" | "left" | "right" {
    const pinAngle = pin.at?.angle ?? 0
    const totalAngle = pinAngle + componentRotation

    return rotationToDirection(totalAngle)
  }
}
