import { cju } from "@tscircuit/circuit-json-util"
import type { AnyCircuitElement } from "circuit-json"
import { parseKicadSym } from "kicadts"
import { CollectSymbolLibrarySymbolsStage } from "./stages/symbol-library/CollectSymbolLibrarySymbolsStage"
import { InitializeSymbolLibraryContextStage } from "./stages/symbol-library/InitializeSymbolLibraryContextStage"
import type { ConverterContext, ConverterStage } from "./types"

export class KicadSymbolToCircuitJsonConverter {
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

  private _findFileWithExtension(extension: string) {
    const filesWithExtension = Object.keys(this.fsMap).filter((key) =>
      key.endsWith(extension),
    )
    if (filesWithExtension.length > 1) {
      throw new Error(
        `Expected 0 or 1 file with extension ${extension}, got ${filesWithExtension.length}. Files: ${filesWithExtension.join(", ")}`,
      )
    }
    return filesWithExtension[0] ?? null
  }

  initializePipeline() {
    const symbolLibFile = this._findFileWithExtension(".kicad_sym")
    if (!symbolLibFile) {
      throw new Error("No .kicad_sym file was added to the converter")
    }

    this.ctx = {
      db: cju([]),
      kicadSymbolLib: parseKicadSym(this.fsMap[symbolLibFile]!),
      warnings: [],
      stats: {},
    }

    this.pipeline = [
      new InitializeSymbolLibraryContextStage(this.ctx),
      new CollectSymbolLibrarySymbolsStage(this.ctx),
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
