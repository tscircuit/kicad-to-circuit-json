import { ConverterStage } from "../../types"
import { applyToPoint } from "transformation-matrix"
import type { SchematicSymbol } from "kicadts"

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

    // Infer component type from library id
    const ftype = this.inferFtype(libId, reference)

    // Create source_component (if it doesn't exist)
    const sourceComponentId = `${libId}_source`
    const existingSource = this.ctx.db.source_component
      .list()
      .find((sc: any) => sc.source_component_id === sourceComponentId)

    if (!existingSource) {
      this.ctx.db.source_component.insert({
        name: libId || reference,
        ftype: ftype as any, // TODO: Fix ftype - should be mapped to valid CJ simple component types
        manufacturer_part_number: value || undefined,
      })
    }

    // Create schematic_component
    const uuid = symbol.uuid
    if (!uuid) return

    const inserted = this.ctx.db.schematic_component.insert({
      source_component_id: sourceComponentId,
      center: { x: cjPos.x, y: cjPos.y },
      size: this.estimateSize(symbol),
    } as any)

    const componentId = inserted.schematic_component_id

    // Map uuid to component id for later reference
    this.ctx.symbolUuidToComponentId?.set(uuid, componentId)

    // Create ports for pins
    this.createPorts(symbol, componentId)

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

  private inferFtype(libId: string, reference: string): string {
    // Infer component type from library id or reference prefix
    const lower = libId.toLowerCase()

    if (lower.includes(":r_") || reference.startsWith("R"))
      return "simple_resistor"
    if (lower.includes(":c_") || reference.startsWith("C"))
      return "simple_capacitor"
    if (lower.includes(":l_") || reference.startsWith("L"))
      return "simple_inductor"
    if (lower.includes(":d_") || reference.startsWith("D"))
      return "simple_diode"
    if (lower.includes(":led") || reference.startsWith("LED"))
      return "simple_led"
    if (lower.includes(":q_") || reference.startsWith("Q"))
      return "simple_transistor"

    // Default to chip for ICs (U prefix) or anything else
    return "chip"
  }

  private getRotation(symbol: SchematicSymbol): number {
    // KiCad rotation is in degrees, CJ uses degrees CCW
    return symbol.at?.angle ?? 0
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

  private createPorts(symbol: SchematicSymbol, componentId: string) {
    // Get the library symbol definition to find pin information
    const libId = symbol.libraryId
    const libSymbol = this.ctx.kicadSch?.libSymbols?.symbols?.find(
      (ls: any) => ls.libraryId === libId,
    )

    if (!libSymbol || !libSymbol.pins) return

    const pins = Array.isArray(libSymbol.pins)
      ? libSymbol.pins
      : [libSymbol.pins]

    for (const pin of pins) {
      // For MVP, place ports at approximate positions
      // A full implementation would transform pin positions relative to symbol
      this.ctx.db.schematic_port.insert({
        schematic_component_id: componentId,
        center: { x: 0, y: 0 }, // Relative to component
        facing_direction: this.inferPinDirection(pin),
        pin_number: (pin as any).pinNumber ?? undefined,
      } as any)
    }
  }

  private inferPinDirection(pin: any): "up" | "down" | "left" | "right" {
    // Map KiCad pin orientation to CJ facing direction
    // KiCad uses: R (right), L (left), U (up), D (down)
    const orientation = pin.orientation || "R"

    switch (orientation) {
      case "R":
        return "right"
      case "L":
        return "left"
      case "U":
        return "up"
      case "D":
        return "down"
      default:
        return "right"
    }
  }
}
