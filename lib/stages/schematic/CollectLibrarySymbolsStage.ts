import { ConverterStage } from "../../types"
import { applyToPoint } from "transformation-matrix"
import type { SchematicSymbol } from "kicadts"
import {
  inferSourceComponentFtype,
  type SupportedSourceComponentFtype,
} from "../symbol-library/infer-source-component-ftype"
import { inferSymbolName } from "./utils/inferSymbolName"
import {
  createSymbolTransform,
  emitKicadSymbolGeometry,
  getPinsForSymbolInstance,
} from "./emitKicadSymbolGeometry"
import { getCircuitJsonPinLabel } from "../../utils/parse-kicad-overline-text"

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
    const libSymbol = this.ctx.kicadSch?.libSymbols?.symbols?.find(
      (librarySymbol) => librarySymbol.libraryId === libId,
    )

    const inserted = this.ctx.db.schematic_component.insert({
      source_component_id: sourceComponent.source_component_id,
      center: { x: cjPos.x, y: cjPos.y },
      size: { width: 1, height: 1 },
      is_box_with_pins: !libSymbol,
      ...(!libSymbol && symbolName ? { symbol_name: symbolName } : {}),
      symbol_display_value: value || undefined,
    })

    const componentId = inserted.schematic_component_id

    // Map uuid to component id for later reference
    this.ctx.symbolUuidToComponentId?.set(uuid, componentId)

    // Create ports for pins
    if (libSymbol) {
      this.createPorts(
        symbol,
        libSymbol,
        sourceComponent.source_component_id,
        componentId,
        cjPos,
      )
      const geometry = emitKicadSymbolGeometry({
        ctx: this.ctx,
        instance: symbol,
        librarySymbol: libSymbol,
        schematicComponentId: componentId,
        componentCenter: cjPos,
      })
      this.ctx.db.schematic_component.update(componentId, {
        size: geometry.size,
      })
    }
    this.createPropertyTexts(symbol)

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

  private createPorts(
    symbol: SchematicSymbol,
    libSymbol: SchematicSymbol,
    sourceComponentId: string,
    componentId: string,
    componentCenter: { x: number; y: number },
  ) {
    if (!this.ctx.k2cMatSch) return
    const allPins = getPinsForSymbolInstance(libSymbol, symbol)

    if (allPins.length === 0) return

    const scaleFactor = Math.abs(this.ctx.k2cMatSch.a || 1 / 15)
    const transform = createSymbolTransform(
      symbol,
      componentCenter,
      scaleFactor,
    )

    for (const pin of allPins) {
      const pinAt = pin.at
      if (!pinAt) continue
      const portCenter = applyToPoint(transform, pinAt)
      const pinAngle = ((pinAt.angle ?? 0) * Math.PI) / 180
      const innerPoint = applyToPoint(transform, {
        x: pinAt.x + Math.cos(pinAngle) * (pin.length || 1),
        y: pinAt.y + Math.sin(pinAngle) * (pin.length || 1),
      })
      const pinNumberLabel = getCircuitJsonPinLabel(pin.numberString || "")
      const pinNumberText = pinNumberLabel.text
      const pinNameLabel = pin.name
        ? getCircuitJsonPinLabel(pin.name)
        : undefined
      const facingDirection = this.vectorToDirection({
        x: portCenter.x - innerPoint.x,
        y: portCenter.y - innerPoint.y,
      })
      const sourcePort = this.ctx.db.source_port.insert({
        source_component_id: sourceComponentId,
        name:
          pinNameLabel?.text ||
          (/^\d+$/.test(pinNumberText) ? `pin${pinNumberText}` : pinNumberText),
        ...(/^\d+$/.test(pinNumberText)
          ? { pin_number: Number(pinNumberText) }
          : { port_hints: pinNumberText ? [pinNumberText] : [] }),
      })

      const sideOfComponent: "top" | "bottom" | "left" | "right" =
        facingDirection === "up"
          ? "top"
          : facingDirection === "down"
            ? "bottom"
            : facingDirection
      const schematicPortData = {
        schematic_component_id: componentId,
        source_port_id: sourcePort.source_port_id,
        center: portCenter,
        facing_direction: facingDirection,
        side_of_component: sideOfComponent,
        pin_number: /^\d+$/.test(pinNumberText)
          ? Number(pinNumberText)
          : undefined,
        display_pin_label:
          !libSymbol.pinNames?.hide && pin.name && pin.name !== "~"
            ? pinNameLabel?.displayText
            : undefined,
        display_pin_label_text_parts:
          !libSymbol.pinNames?.hide && pin.name && pin.name !== "~"
            ? pinNameLabel?.textParts
            : undefined,
        distance_from_component_edge:
          !pin.hidden && pin.length ? pin.length * scaleFactor : undefined,
      }
      this.ctx.db.schematic_port.insert(schematicPortData)
    }
  }

  private vectorToDirection(vector: {
    x: number
    y: number
  }): "up" | "down" | "left" | "right" {
    if (Math.abs(vector.x) >= Math.abs(vector.y)) {
      return vector.x >= 0 ? "right" : "left"
    }
    return vector.y >= 0 ? "up" : "down"
  }

  private createPropertyTexts(symbol: SchematicSymbol) {
    if (!this.ctx.k2cMatSch) return

    for (const property of symbol.properties) {
      if (
        property.hidden ||
        property.effects?.hiddenText ||
        !property.value ||
        (property.key !== "Reference" && property.key !== "Value")
      ) {
        continue
      }

      const fontSize = property.effects?.font?.size
      this.ctx.db.schematic_text.insert({
        text: property.value,
        font_size: Math.max(
          0.05,
          Math.max(fontSize?.height ?? 1.27, fontSize?.width ?? 1.27) *
            Math.abs(this.ctx.k2cMatSch.a),
        ),
        position: applyToPoint(
          this.ctx.k2cMatSch,
          property.at ?? symbol.at ?? { x: 0, y: 0 },
        ),
        rotation: normalizeReadableRotation(
          -(property.at?.angle ?? 0) + (symbol.at?.angle ?? 0),
        ),
        anchor: property.effects?.justify?.horizontal ?? "center",
        color: "rgb(132, 0, 0)",
      })
    }
  }
}

const normalizeReadableRotation = (rotation: number): number => {
  let normalized = ((rotation % 360) + 360) % 360
  if (normalized > 180) normalized -= 360
  if (normalized > 90) normalized -= 180
  if (normalized < -90) normalized += 180
  return normalized
}
