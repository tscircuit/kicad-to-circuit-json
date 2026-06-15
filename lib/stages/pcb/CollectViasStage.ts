import { applyToPoint } from "transformation-matrix"
import { ConverterStage } from "../../types"
import {
  getCopperSpanLayerRefsFromLayers,
  getPcbCopperLayerRefs,
} from "./layer-mapping"

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

    const mappedLayers = via.layers
      ? getCopperSpanLayerRefsFromLayers(via.layers, this.ctx.kicadPcb)
      : []
    const layers =
      mappedLayers.length > 0
        ? mappedLayers
        : getPcbCopperLayerRefs(this.ctx.kicadPcb)

    const fromLayer = layers[0]
    const toLayer = layers[layers.length - 1]

    // Route vias inside pcb_trace describe layer transitions, but renderers such
    // as pcb-viewer draw visible via drills from standalone pcb_via elements.
    this.ctx.db.pcb_via.insert({
      x: pos.x,
      y: pos.y,
      outer_diameter: size,
      hole_diameter: drill,
      layers,
      ...(fromLayer ? { from_layer: fromLayer } : {}),
      ...(toLayer ? { to_layer: toLayer } : {}),
    })

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.vias = (this.ctx.stats.vias || 0) + 1
    }
  }
}
