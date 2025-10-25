import { ConverterStage } from "../../types"
import { compose, scale, translate } from "transformation-matrix"

/**
 * InitializePcbContextStage sets up the coordinate transformation
 * from KiCad PCB space to Circuit JSON space.
 *
 * KiCad→CJ PCB transform (inverse of CJ→KiCad):
 * - CJ→KiCad used: translate(100, 100) ∘ scale(1, -1)
 * - KiCad→CJ uses: scale(1, -1) ∘ translate(-100, -100)
 */
export class InitializePcbContextStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadPcb) {
      this.finished = true
      return false
    }

    // Build the transform for PCB
    // For MVP, just flip Y axis. KiCad PCB coordinates are in mm, Circuit JSON also uses mm.
    // KiCad has Y increasing downward, Circuit JSON has Y increasing upward
    this.ctx.k2cMatPcb = scale(1, -1)

    // Initialize net mapping
    this.ctx.netNumToName = new Map()
    this.ctx.footprintUuidToComponentId = new Map()

    this.finished = true
    return false
  }
}
