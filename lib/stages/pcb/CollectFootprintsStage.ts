import { ConverterStage } from "../../types"
import { applyToPoint, compose, rotateDEG, translate } from "transformation-matrix"
import type { Footprint } from "kicadts"

/**
 * CollectFootprintsStage converts KiCad footprints into Circuit JSON pcb_components,
 * along with their associated pads (SMT, plated holes, NPTH) and silkscreen text.
 */
export class CollectFootprintsStage extends ConverterStage {
  private processedFootprints = new Set<string>()

  step(): boolean {
    if (!this.ctx.kicadPcb || !this.ctx.k2cMatPcb) {
      this.finished = true
      return false
    }

    const footprints = this.ctx.kicadPcb.footprints || []
    const footprintArray = Array.isArray(footprints) ? footprints : [footprints]

    for (const footprint of footprintArray) {
      const uuid = footprint.uuid?.value
      if (!uuid) continue
      if (this.processedFootprints.has(uuid)) continue

      this.processFootprint(footprint)
      this.processedFootprints.add(uuid)
    }

    this.finished = true
    return false
  }

  private processFootprint(footprint: Footprint) {
    if (!this.ctx.k2cMatPcb) return

    // Get footprint position and rotation
    const position = footprint.position
    const kicadPos = { x: position?.x ?? 0, y: position?.y ?? 0 }
    const cjPos = applyToPoint(this.ctx.k2cMatPcb, kicadPos)
    const rotation = (position as any)?.angle ?? 0

    // Get reference (component name)
    const reference = this.getTextValue(footprint, "reference") || footprint.libraryLink || "U?"

    // Create pcb_component
    const uuid = footprint.uuid?.value
    if (!uuid) return

    const inserted = this.ctx.db.pcb_component.insert({
      center: { x: cjPos.x, y: cjPos.y },
      layer: this.getComponentLayer(footprint),
      width: 0, // Will be computed from pads if needed
      height: 0,
    } as any)

    const componentId = inserted.pcb_component_id

    // Map footprint UUID to component ID
    this.ctx.footprintUuidToComponentId?.set(uuid, componentId)

    // Process pads
    this.processPads(footprint, componentId, cjPos, rotation)

    // Process footprint text as silkscreen
    this.processFootprintText(footprint, componentId)

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.components = (this.ctx.stats.components || 0) + 1
    }
  }

  private getTextValue(footprint: Footprint, type: string): string | undefined {
    const texts = footprint.fpTexts || []
    const textArray = Array.isArray(texts) ? texts : [texts]
    const text = textArray.find((t: any) => t.type === type)
    return text?.text
  }

  private getComponentLayer(footprint: Footprint): "top" | "bottom" {
    // Check if footprint is on back layer
    const layer = footprint.layer
    const layerNames = layer?.names || []
    if (layerNames.some((name) => name.includes("B.Cu") || name.includes("Back"))) {
      return "bottom"
    }
    return "top"
  }

  private processPads(
    footprint: Footprint,
    componentId: string,
    componentCenter: { x: number; y: number },
    componentRotation: number
  ) {
    if (!this.ctx.k2cMatPcb) return

    const pads = footprint.fpPads || []
    const padArray = Array.isArray(pads) ? pads : [pads]

    for (const pad of padArray) {
      this.processPad(pad, componentId, componentCenter, componentRotation)
    }
  }

  private processPad(
    pad: any,
    componentId: string,
    componentCenter: { x: number; y: number },
    componentRotation: number
  ) {
    if (!this.ctx.k2cMatPcb) return

    const padAt = pad.at || { x: 0, y: 0, a: 0 }
    const padType = pad.type || "thru_hole"
    const padShape = pad.shape || "circle"

    // Transform pad position relative to component
    // First rotate around component center, then apply global transform
    const relativePos = { x: padAt.x, y: padAt.y }
    const rotMatrix = compose(
      translate(componentCenter.x, componentCenter.y),
      rotateDEG(componentRotation),
      translate(0, 0)
    )
    const globalPos = applyToPoint(this.ctx.k2cMatPcb, {
      x: componentCenter.x + relativePos.x,
      y: componentCenter.y + relativePos.y,
    })

    // Get pad size
    const size = pad.size || { x: 1, y: 1 }
    const drill = pad.drill

    // Determine pad type and create appropriate CJ element
    if (padType === "smd") {
      this.createSmdPad(pad, componentId, globalPos, size, padShape)
    } else if (padType === "np_thru_hole") {
      this.createNpthHole(pad, componentId, globalPos, drill)
    } else {
      // thru_hole (plated)
      this.createPlatedHole(pad, componentId, globalPos, size, drill, padShape)
    }
  }

  private createSmdPad(
    pad: any,
    componentId: string,
    pos: { x: number; y: number },
    size: { x: number; y: number },
    shape: string
  ) {
    const layers = pad.layers || []
    const layer = this.determinePadLayer(layers)

    this.ctx.db.pcb_smtpad.insert({
      pcb_component_id: componentId,
      layer: layer,
      shape: shape === "circle" ? "circle" : "rect",
      width: size.x,
      height: size.y,
      port_hints: [pad.number?.toString()],
    } as any)

    if (this.ctx.stats) {
      this.ctx.stats.pads = (this.ctx.stats.pads || 0) + 1
    }
  }

  private createPlatedHole(
    pad: any,
    componentId: string,
    pos: { x: number; y: number },
    size: { x: number; y: number },
    drill: any,
    shape: string
  ) {
    // Determine hole shape - map to CJ plated hole shapes
    let holeShape: "circle" | "pill" | "oval" | "circular_hole_with_rect_pad" | "pill_hole_with_rect_pad" | "rotated_pill_hole_with_rect_pad" = "circle"
    if (shape === "oval") {
      holeShape = "pill"
    } else if (shape === "rect" || shape === "square") {
      holeShape = "circular_hole_with_rect_pad"
    }

    const holeDiameter = drill?.diameter || drill || 0.8

    this.ctx.db.pcb_plated_hole.insert({
      pcb_component_id: componentId,
      hole_diameter: holeDiameter,
      shape: holeShape,
      port_hints: [pad.number?.toString()],
    } as any)

    if (this.ctx.stats) {
      this.ctx.stats.pads = (this.ctx.stats.pads || 0) + 1
    }
  }

  private createNpthHole(
    pad: any,
    componentId: string,
    pos: { x: number; y: number },
    drill: any
  ) {
    const holeDiameter = drill?.diameter || drill || 1.0

    this.ctx.db.pcb_hole.insert({
      hole_diameter: holeDiameter,
      hole_shape: "circle",
    } as any)
  }

  private determinePadLayer(layers: string[]): "top" | "bottom" {
    if (layers.includes("B.Cu") || layers.includes("Back")) {
      return "bottom"
    }
    return "top"
  }

  private processFootprintText(footprint: Footprint, componentId: string) {
    if (!this.ctx.k2cMatPcb) return

    const texts = footprint.fpTexts || []
    const textArray = Array.isArray(texts) ? texts : [texts]

    for (const text of textArray) {
      // Skip reference and value text for now (they're metadata)
      if (text.type === "reference" || text.type === "value") continue

      this.createSilkscreenText(text, componentId)
    }
  }

  private createSilkscreenText(text: any, componentId: string) {
    if (!this.ctx.k2cMatPcb) return

    const at = text.at
    const pos = applyToPoint(this.ctx.k2cMatPcb, { x: at?.x ?? 0, y: at?.y ?? 0 })

    const layer = this.mapTextLayer(text.layer)

    this.ctx.db.pcb_silkscreen_text.insert({
      pcb_component_id: componentId,
      font: "tscircuit2024",
      font_size: text.effects?.font?.size?.y || 1,
      text: text.text || "",
      anchor_position: pos,
      layer: layer,
    } as any)
  }

  private mapTextLayer(kicadLayer: string): "top" | "bottom" {
    if (kicadLayer?.includes("B.") || kicadLayer?.includes("Back")) {
      return "bottom"
    }
    return "top"
  }
}
