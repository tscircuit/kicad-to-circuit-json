import { ConverterStage } from "../../../types"
import { processFootprint } from "./process-footprint"

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

      processFootprint(this.ctx, footprint)
      this.processedFootprints.add(uuid)
    }

    this.finished = true
    return false
  }
}
