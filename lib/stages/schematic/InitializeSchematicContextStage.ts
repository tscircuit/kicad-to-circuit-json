import { ConverterStage } from "../../types"
import { compose, scale, translate, type Matrix } from "transformation-matrix"

/**
 * InitializeSchematicContextStage sets up the coordinate transformation
 * from KiCad schematic space to Circuit JSON space.
 *
 * KiCad→CJ schematic transform (inverse of CJ→KiCad):
 * - CJ→KiCad used: translate(KICAD_CENTER) ∘ scale(15, -15) ∘ translate(-center)
 * - KiCad→CJ uses: translate(center) ∘ scale(1/15, -1/15) ∘ translate(-KICAD_CENTER)
 */
export class InitializeSchematicContextStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadSch) {
      this.finished = true
      return false
    }

    // KiCad schematic paper center (typically A4 paper)
    // Standard A4 is 210mm x 297mm, KiCad uses 0.1mil units
    // Common paper center is around (105, 148.5) mm
    const KICAD_CENTER_X = 105
    const KICAD_CENTER_Y = 148.5

    // Get the paper size from the schematic if available
    // For now, use defaults - can be enhanced to parse from kicadSch.paper if needed
    const kicadCenterX = KICAD_CENTER_X
    const kicadCenterY = KICAD_CENTER_Y

    // We'll compute the actual center of the schematic content later
    // For now, assume centered at origin in CJ space
    const cjCenterX = 0
    const cjCenterY = 0

    // Build the inverse transform:
    // 1. Translate from KiCad paper center
    // 2. Scale down and flip Y
    // 3. Translate to CJ center
    this.ctx.k2cMatSch = compose(
      translate(cjCenterX, cjCenterY),
      scale(1 / 15, -1 / 15),
      translate(-kicadCenterX, -kicadCenterY)
    )

    // Initialize tracking maps
    this.ctx.symbolUuidToComponentId = new Map()
    this.ctx.warnings = this.ctx.warnings || []
    this.ctx.stats = this.ctx.stats || {}

    this.finished = true
    return false
  }
}
