import { ConverterStage } from "../../types"
import { compose, scale, translate } from "transformation-matrix"
import {
  getSchematicPaperSize,
  SCHEMATIC_UNIT_TO_MM,
} from "./getSchematicPaperSize"

/**
 * InitializeSchematicContextStage sets up the coordinate transformation
 * from KiCad schematic space to Circuit JSON space.
 *
 * KiCad→CJ schematic transform (inverse of CJ→KiCad):
 * - CJ→KiCad used: translate(KICAD_CENTER) ∘ scale(15, -15) ∘ translate(-center)
 * - KiCad→CJ uses: translate(center) ∘ scale(1/15, -1/15) ∘ translate(-KICAD_CENTER)
 * Sheet output instead uses the source paper center and the renderer's scale.
 */
export class InitializeSchematicContextStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadSch) {
      this.finished = true
      return false
    }

    const { width, height } = getSchematicPaperSize(this.ctx.kicadSch.paper)
    const withSheet = this.ctx.includeSchematicSheet === true
    // Keep the existing circuit-only coordinates. Sheet views are centered on
    // the actual paper and use the same physical scale as the sheet renderer.
    const unitToMm = withSheet ? SCHEMATIC_UNIT_TO_MM : 15
    this.ctx.k2cMatSch = compose(
      scale(1 / unitToMm, -1 / unitToMm),
      translate(
        withSheet ? -width / 2 : -105,
        withSheet ? -height / 2 : -148.5,
      ),
    )

    if (withSheet) {
      const sheet = this.ctx.db.schematic_sheet.insert({
        name: this.ctx.kicadSch.titleBlock?.title || "KiCad schematic",
        sheet_index: 0,
        sheet_width: width,
        sheet_height: height,
      })
      this.ctx.schematicSheetId = sheet.schematic_sheet_id
    }

    // Initialize tracking maps
    this.ctx.symbolUuidToComponentId = new Map()
    this.ctx.warnings = this.ctx.warnings || []
    this.ctx.stats = this.ctx.stats || {}

    this.finished = true
    return false
  }
}
