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

    // Process pads - pass KiCad position for correct transformation
    this.processPads(footprint, componentId, kicadPos, rotation)

    // Process footprint text as silkscreen - pass KiCad position and rotation for correct transformation
    this.processFootprintText(footprint, componentId, kicadPos, rotation)

    // Process footprint graphics (fp_line, fp_circle, fp_arc) as silkscreen
    this.processFootprintGraphics(footprint, componentId, kicadPos, rotation)

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

  private getPropertyValue(footprint: Footprint, propertyName: string): string | undefined {
    const properties = footprint.properties || []
    const propertyArray = Array.isArray(properties) ? properties : [properties]
    const property = propertyArray.find((p: any) => p.key === propertyName)
    return property?.value
  }

  private substituteKicadVariables(text: string, footprint: Footprint): string {
    let result = text

    // Get reference and value from properties
    const reference = this.getPropertyValue(footprint, "Reference") ||
                      this.getTextValue(footprint, "reference") ||
                      "?"
    const value = this.getPropertyValue(footprint, "Value") ||
                  this.getTextValue(footprint, "value") ||
                  ""

    // Replace KiCad variables
    result = result.replace(/\$\{REFERENCE\}/g, reference)
    result = result.replace(/\$\{VALUE\}/g, value)

    return result
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
    kicadComponentPos: { x: number; y: number },
    componentRotation: number
  ) {
    if (!this.ctx.k2cMatPcb) return

    const pads = footprint.fpPads || []
    const padArray = Array.isArray(pads) ? pads : [pads]

    for (const pad of padArray) {
      this.processPad(pad, componentId, kicadComponentPos, componentRotation)
    }
  }

  private processPad(
    pad: any,
    componentId: string,
    kicadComponentPos: { x: number; y: number },
    componentRotation: number
  ) {
    if (!this.ctx.k2cMatPcb) return

    const padAt = pad.at || { x: 0, y: 0, a: 0 }
    const padType = pad.type || "thru_hole"
    const padShape = pad.shape || "circle"

    // Get pad position in KiCad global coordinates
    // Pad position is relative to component and needs to be rotated
    const rotationRad = (componentRotation * Math.PI) / 180
    const rotatedPadX = padAt.x * Math.cos(rotationRad) - padAt.y * Math.sin(rotationRad)
    const rotatedPadY = padAt.x * Math.sin(rotationRad) + padAt.y * Math.cos(rotationRad)

    const padKicadPos = {
      x: kicadComponentPos.x + rotatedPadX,
      y: kicadComponentPos.y + rotatedPadY,
    }

    // Transform from KiCad to Circuit JSON coordinates
    const globalPos = applyToPoint(this.ctx.k2cMatPcb, padKicadPos)

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
      x: pos.x,
      y: pos.y,
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
      x: pos.x,
      y: pos.y,
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
      x: pos.x,
      y: pos.y,
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

  private processFootprintText(footprint: Footprint, componentId: string, kicadComponentPos: { x: number; y: number }, componentRotation: number) {
    if (!this.ctx.k2cMatPcb) return

    const texts = footprint.fpTexts || []
    const textArray = Array.isArray(texts) ? texts : [texts]

    for (const text of textArray) {
      // Skip reference and value text for now (they're metadata)
      if (text.type === "reference" || text.type === "value") continue

      this.createSilkscreenText(text, componentId, kicadComponentPos, componentRotation, footprint)
    }
  }

  private createSilkscreenText(text: any, componentId: string, kicadComponentPos: { x: number; y: number }, componentRotation: number, footprint: Footprint) {
    if (!this.ctx.k2cMatPcb) return

    const at = text.at
    // Text position in footprint is relative to footprint position and needs to be rotated
    const textLocalX = at?.x ?? 0
    const textLocalY = at?.y ?? 0

    const rotationRad = (componentRotation * Math.PI) / 180
    const rotatedTextX = textLocalX * Math.cos(rotationRad) - textLocalY * Math.sin(rotationRad)
    const rotatedTextY = textLocalX * Math.sin(rotationRad) + textLocalY * Math.cos(rotationRad)

    const textKicadPos = {
      x: kicadComponentPos.x + rotatedTextX,
      y: kicadComponentPos.y + rotatedTextY,
    }
    const pos = applyToPoint(this.ctx.k2cMatPcb, textKicadPos)

    const layer = this.mapTextLayer(text.layer)

    // Substitute KiCad variables in text
    const processedText = this.substituteKicadVariables(text.text || "", footprint)

    this.ctx.db.pcb_silkscreen_text.insert({
      pcb_component_id: componentId,
      font: "tscircuit2024",
      font_size: text.effects?.font?.size?.y || 1,
      text: processedText,
      anchor_position: pos,
      layer: layer,
    } as any)
  }

  private mapTextLayer(kicadLayer: any): "top" | "bottom" {
    // Handle both string and Layer object
    const layerStr = typeof kicadLayer === "string" ? kicadLayer : (kicadLayer?.names?.join(" ") || "")
    if (layerStr.includes("B.") || layerStr.includes("Back")) {
      return "bottom"
    }
    return "top"
  }

  private processFootprintGraphics(footprint: Footprint, componentId: string, kicadComponentPos: { x: number; y: number }, componentRotation: number) {
    if (!this.ctx.k2cMatPcb) return

    // Process fp_line elements
    const lines = (footprint as any).fpLines || []
    const lineArray = Array.isArray(lines) ? lines : (lines ? [lines] : [])
    for (const line of lineArray) {
      this.createFootprintLine(line, componentId, kicadComponentPos, componentRotation)
    }

    // Process fp_circle elements
    const circles = (footprint as any).fpCircles || []
    const circleArray = Array.isArray(circles) ? circles : (circles ? [circles] : [])
    for (const circle of circleArray) {
      this.createFootprintCircle(circle, componentId, kicadComponentPos, componentRotation)
    }

    // Process fp_arc elements
    const arcs = (footprint as any).fpArcs || []
    const arcArray = Array.isArray(arcs) ? arcs : (arcs ? [arcs] : [])
    for (const arc of arcArray) {
      this.createFootprintArc(arc, componentId, kicadComponentPos, componentRotation)
    }
  }

  private rotatePoint(x: number, y: number, rotationDeg: number): { x: number; y: number } {
    const rotationRad = (rotationDeg * Math.PI) / 180
    return {
      x: x * Math.cos(rotationRad) - y * Math.sin(rotationRad),
      y: x * Math.sin(rotationRad) + y * Math.cos(rotationRad),
    }
  }

  private createFootprintLine(line: any, componentId: string, kicadComponentPos: { x: number; y: number }, componentRotation: number) {
    if (!this.ctx.k2cMatPcb) return

    const start = line.start || { x: 0, y: 0 }
    const end = line.end || { x: 0, y: 0 }

    // Rotate line points by component rotation
    const rotatedStart = this.rotatePoint(start.x, start.y, componentRotation)
    const rotatedEnd = this.rotatePoint(end.x, end.y, componentRotation)

    // Apply component position
    const startKicadPos = {
      x: kicadComponentPos.x + rotatedStart.x,
      y: kicadComponentPos.y + rotatedStart.y,
    }
    const endKicadPos = {
      x: kicadComponentPos.x + rotatedEnd.x,
      y: kicadComponentPos.y + rotatedEnd.y,
    }

    // Transform to Circuit JSON coordinates
    const startPos = applyToPoint(this.ctx.k2cMatPcb, startKicadPos)
    const endPos = applyToPoint(this.ctx.k2cMatPcb, endKicadPos)

    const layer = this.mapTextLayer(line.layer)
    const strokeWidth = line.stroke?.width || line.width || 0.12

    this.ctx.db.pcb_silkscreen_path.insert({
      pcb_component_id: componentId,
      layer: layer,
      route: [startPos, endPos],
      stroke_width: strokeWidth,
    })
  }

  private createFootprintCircle(circle: any, componentId: string, kicadComponentPos: { x: number; y: number }, componentRotation: number) {
    if (!this.ctx.k2cMatPcb) return

    const center = circle.center || { x: 0, y: 0 }
    const end = circle.end || { x: 0, y: 0 }

    // Calculate radius (distance from center to end point)
    const radius = Math.sqrt((end.x - center.x) ** 2 + (end.y - center.y) ** 2)

    // Rotate center by component rotation
    const rotatedCenter = this.rotatePoint(center.x, center.y, componentRotation)

    // Apply component position
    const centerKicadPos = {
      x: kicadComponentPos.x + rotatedCenter.x,
      y: kicadComponentPos.y + rotatedCenter.y,
    }

    // Transform to Circuit JSON coordinates
    const centerPos = applyToPoint(this.ctx.k2cMatPcb, centerKicadPos)

    const layer = this.mapTextLayer(circle.layer)
    const strokeWidth = circle.stroke?.width || circle.width || 0.12

    // Create circle as a pcb_silkscreen_circle (if supported) or as a path with many points
    // For now, approximate with an octagon
    const numPoints = 16
    const circleRoute: Array<{ x: number; y: number }> = []
    for (let i = 0; i <= numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI
      const x = centerPos.x + radius * Math.cos(angle)
      const y = centerPos.y + radius * Math.sin(angle)
      circleRoute.push({ x, y })
    }

    this.ctx.db.pcb_silkscreen_path.insert({
      pcb_component_id: componentId,
      layer: layer,
      route: circleRoute,
      stroke_width: strokeWidth,
    })
  }

  private createFootprintArc(arc: any, componentId: string, kicadComponentPos: { x: number; y: number }, componentRotation: number) {
    if (!this.ctx.k2cMatPcb) return

    const start = arc.start || { x: 0, y: 0 }
    const mid = arc.mid || { x: 0, y: 0 }
    const end = arc.end || { x: 0, y: 0 }

    // Rotate arc points by component rotation
    const rotatedStart = this.rotatePoint(start.x, start.y, componentRotation)
    const rotatedMid = this.rotatePoint(mid.x, mid.y, componentRotation)
    const rotatedEnd = this.rotatePoint(end.x, end.y, componentRotation)

    // Apply component position
    const startKicadPos = { x: kicadComponentPos.x + rotatedStart.x, y: kicadComponentPos.y + rotatedStart.y }
    const midKicadPos = { x: kicadComponentPos.x + rotatedMid.x, y: kicadComponentPos.y + rotatedMid.y }
    const endKicadPos = { x: kicadComponentPos.x + rotatedEnd.x, y: kicadComponentPos.y + rotatedEnd.y }

    // Transform to Circuit JSON coordinates
    const startPos = applyToPoint(this.ctx.k2cMatPcb, startKicadPos)
    const midPos = applyToPoint(this.ctx.k2cMatPcb, midKicadPos)
    const endPos = applyToPoint(this.ctx.k2cMatPcb, endKicadPos)

    const layer = this.mapTextLayer(arc.layer)
    const strokeWidth = arc.stroke?.width || arc.width || 0.12

    // Approximate arc with multiple line segments
    // For simplicity, use start-mid-end as a rough approximation
    // A better implementation would calculate the actual arc
    const numSegments = 8
    const arcRoute: Array<{ x: number; y: number }> = [startPos]

    // Simple linear interpolation for now (not a true arc, but better than nothing)
    for (let i = 1; i < numSegments; i++) {
      const t = i / numSegments
      if (t < 0.5) {
        const t2 = t * 2
        arcRoute.push({
          x: startPos.x + (midPos.x - startPos.x) * t2,
          y: startPos.y + (midPos.y - startPos.y) * t2,
        })
      } else {
        const t2 = (t - 0.5) * 2
        arcRoute.push({
          x: midPos.x + (endPos.x - midPos.x) * t2,
          y: midPos.y + (endPos.y - midPos.y) * t2,
        })
      }
    }
    arcRoute.push(endPos)

    this.ctx.db.pcb_silkscreen_path.insert({
      pcb_component_id: componentId,
      layer: layer,
      route: arcRoute,
      stroke_width: strokeWidth,
    })
  }
}
