import { ConverterStage } from "../../types"
import { processFootprint } from "../pcb/CollectFootprintsStage/process-footprint"

export class CollectFootprintStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadMod || !this.ctx.k2cMatPcb) {
      this.finished = true
      return false
    }

    processFootprint(this.ctx, this.ctx.kicadMod)

    this.finished = true
    return false
  }
}
