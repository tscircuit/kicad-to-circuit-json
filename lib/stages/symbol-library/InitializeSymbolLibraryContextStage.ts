import { ConverterStage } from "../../types"

/**
 * InitializeSymbolLibraryContextStage prepares shared state for .kicad_sym
 * conversion. Symbol libraries have no schematic placements, so this branch
 * emits source-level Circuit JSON only.
 */
export class InitializeSymbolLibraryContextStage extends ConverterStage {
  step(): boolean {
    if (!this.ctx.kicadSymbolLib) {
      this.finished = true
      return false
    }

    this.ctx.warnings = this.ctx.warnings || []
    this.ctx.stats = this.ctx.stats || {}

    this.finished = true
    return false
  }
}
