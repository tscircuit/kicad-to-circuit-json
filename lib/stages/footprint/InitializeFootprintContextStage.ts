import { scale } from "transformation-matrix"
import { ConverterStage } from "../../types"

export class InitializeFootprintContextStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadMod) {
      this.finished = true
      return false
    }

    this.ctx.k2cMatPcb = scale(1, -1)
    this.ctx.netNumToName = new Map([[0, ""]])
    this.ctx.netNumToSourceNetId = new Map()
    this.ctx.netNumToSourcePortIds = new Map()
    this.ctx.footprintUuidToComponentId = new Map()
    this.ctx.footprintUuidToSourceComponentId = new Map()

    this.finished = true
    return false
  }
}
