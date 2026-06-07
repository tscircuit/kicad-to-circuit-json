import { cju } from "@tscircuit/circuit-json-util"
import type { AnyCircuitElement } from "circuit-json"
import { parseKicadMod } from "kicadts"
import type { Footprint } from "kicadts"
import { CollectFootprintStage } from "./stages/footprint/CollectFootprintStage"
import { InitializeFootprintContextStage } from "./stages/footprint/InitializeFootprintContextStage"
import type { ConverterContext, ConverterStage } from "./types"

export class KicadFootprintToCircuitJsonConverter {
  fsMap: Record<string, string> = {}
  ctx?: ConverterContext

  currentStageIndex = 0

  pipeline?: ConverterStage[]

  get currentStage() {
    return this.pipeline?.[this.currentStageIndex]
  }

  addFile(filePath: string, content: string) {
    this.fsMap[filePath] = content
  }

  private findFootprintFile() {
    const footprintFiles = Object.keys(this.fsMap).filter((key) =>
      key.endsWith(".kicad_mod"),
    )

    if (footprintFiles.length !== 1) {
      throw new Error(
        `Expected exactly 1 file with extension .kicad_mod, got ${footprintFiles.length}. Files: ${footprintFiles.join(", ")}`,
      )
    }

    return footprintFiles[0]!
  }

  private prepareKicadModFootprint(footprint: Footprint, filePath: string) {
    if (!footprint.uuid?.value && !footprint.tstamp?.value) {
      footprint.uuid = `kicad_mod:${filePath}`
    }

    return footprint
  }

  initializePipeline() {
    const footprintFile = this.findFootprintFile()
    const kicadMod = this.prepareKicadModFootprint(
      parseKicadMod(this.fsMap[footprintFile]!),
      footprintFile,
    )

    this.ctx = {
      db: cju([]),
      kicadMod,
      warnings: [],
      stats: {},
    }

    this.pipeline = [
      new InitializeFootprintContextStage(this.ctx),
      new CollectFootprintStage(this.ctx),
    ]
  }

  step() {
    if (!this.pipeline) {
      this.initializePipeline()
    }

    if (!this.currentStage) {
      return false
    }

    const hasMoreWork = this.currentStage.step()

    if (!hasMoreWork || this.currentStage.finished) {
      this.currentStageIndex++
    }

    return this.currentStageIndex < (this.pipeline?.length || 0)
  }

  runUntilFinished() {
    if (!this.pipeline) {
      this.initializePipeline()
    }

    for (const stage of this.pipeline || []) {
      stage.runUntilFinished()
    }
  }

  getOutput(): AnyCircuitElement[] {
    if (!this.ctx) {
      this.initializePipeline()
      this.runUntilFinished()
    }

    return this.ctx!.db.toArray()
  }

  getOutputString() {
    return JSON.stringify(this.getOutput(), null, 2)
  }

  getWarnings() {
    return this.ctx?.warnings || []
  }

  getStats() {
    return this.ctx?.stats || {}
  }
}
