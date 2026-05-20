import { applyToPoint } from "transformation-matrix"
import { ConverterStage } from "../../types"
import {
  getCopperSpanLayerRefsFromLayers,
  getPcbCopperLayerRefs,
} from "./layer-mapping"

/**
 * CollectViasStage converts every physical KiCad via into a Circuit JSON
 * pcb_via element.
 *
 * We intentionally do not dedupe against `pcb_trace.route` via points here.
 * Those route points only describe how a trace changes layers while preserving
 * connectivity. They are not a replacement for the physical via object.
 *
 * The previous behavior skipped pcb_via insertion whenever a matching
 * route-level via marker already existed at the same position/layers. That
 * caused real vias to disappear from Circuit JSON output on boards such as the
 * Arduino Nano, where many vias are both part of a trace route and physical
 * drilled objects on the PCB.
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

    // Always emit the physical via even if trace routing also records a
    // same-location route_type="via" point for connectivity.
    this.ctx.db.pcb_via.insert({
      x: pos.x,
      y: pos.y,
      outer_diameter: size,
      hole_diameter: drill,
      layers,
    })

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.vias = (this.ctx.stats.vias || 0) + 1
    }
  }
}
