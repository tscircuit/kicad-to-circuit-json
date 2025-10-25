import { ConverterStage } from "../../types"
import { applyToPoint } from "transformation-matrix"

/**
 * CollectViasStage converts KiCad vias into Circuit JSON pcb_via elements.
 */
export class CollectViasStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadPcb || !this.ctx.k2cMatPcb || !this.ctx.netNumToName) {
      this.finished = true
      return false
    }

    const vias = this.ctx.kicadPcb.vias || []
    const viaArray = Array.isArray(vias) ? vias : [vias]

    for (const via of viaArray) {
      this.processVia(via)
    }

    this.finished = true
    return false
  }

  private processVia(via: any) {
    if (!this.ctx.k2cMatPcb || !this.ctx.netNumToName) return

    const at = via.at || { x: 0, y: 0 }
    const pos = applyToPoint(this.ctx.k2cMatPcb, { x: at.x, y: at.y })

    // Get via dimensions
    const size = via.size || 0.8
    const drill = via.drill || 0.4

    // Get net name
    const netNum = via.net || 0
    const netName = this.ctx.netNumToName.get(netNum) || ""

    // Determine layers (for MVP, assume through-hole vias connecting top to bottom)
    const layers = via.layers || ["F.Cu", "B.Cu"]
    const fromLayer = this.mapLayer(layers[0])
    const toLayer = layers.length > 1 ? this.mapLayer(layers[layers.length - 1]) : fromLayer

    // Create pcb_via
    this.ctx.db.pcb_via.insert({
      x: pos.x,
      y: pos.y,
      outer_diameter: size,
      hole_diameter: drill,
      layers: [fromLayer, toLayer],
    })

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.vias = (this.ctx.stats.vias || 0) + 1
    }
  }

  private mapLayer(kicadLayer: string): "top" | "bottom" {
    if (kicadLayer?.includes("B.Cu") || kicadLayer?.includes("Back")) {
      return "bottom"
    }
    return "top"
  }
}
