import { cju } from "@tscircuit/circuit-json-util"
import type { AnyCircuitElement } from "circuit-json"
import { parseKicadPcb, parseKicadSch, parseKicadSym } from "kicadts"
import { CollectFootprintsStage } from "./stages/pcb/CollectFootprintsStage"
import { CollectGraphicsStage } from "./stages/pcb/CollectGraphicsStage"
import { CollectNetsStage } from "./stages/pcb/CollectNetsStage"
import { CollectSourceTracesStage } from "./stages/pcb/CollectSourceTracesStage"
import { CollectTracesStage } from "./stages/pcb/CollectTracesStage"
import { CollectViasStage } from "./stages/pcb/CollectViasStage"
import { CollectZonesStage } from "./stages/pcb/CollectZonesStage"
// Import PCB stages
import { InitializePcbContextStage } from "./stages/pcb/InitializePcbContextStage"
import { CollectLibrarySymbolsStage } from "./stages/schematic/CollectLibrarySymbolsStage"
import { CollectSchematicTracesStage } from "./stages/schematic/CollectSchematicTracesStage"
// Import schematic stages
import { InitializeSchematicContextStage } from "./stages/schematic/InitializeSchematicContextStage"
import { CollectSymbolLibrarySymbolsStage } from "./stages/symbol-library/CollectSymbolLibrarySymbolsStage"
import { InitializeSymbolLibraryContextStage } from "./stages/symbol-library/InitializeSymbolLibraryContextStage"
import type { ConverterContext, ConverterStage } from "./types"

export class KicadToCircuitJsonConverter {
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

  _findFileWithExtension(extension: string) {
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
    const pcbFile = this._findFileWithExtension(".kicad_pcb")
    const schFile = this._findFileWithExtension(".kicad_sch")
    const symbolLibFile = this._findFileWithExtension(".kicad_sym")
    const kicadModFile = this._findFileWithExtension(".kicad_mod")

    if (kicadModFile) {
      throw new Error(
        "Standalone .kicad_mod conversion is handled by KicadFootprintToCircuitJsonConverter, not KicadToCircuitJsonConverter.",
      )
    }

    this.ctx = {
      db: cju([]),
      kicadPcb: pcbFile ? parseKicadPcb(this.fsMap[pcbFile]!) : undefined,
      kicadSch: schFile ? parseKicadSch(this.fsMap[schFile]!) : undefined,
      kicadSymbolLib: symbolLibFile
        ? parseKicadSym(this.fsMap[symbolLibFile]!)
        : undefined,
      warnings: [],
      stats: {},
    }

    // Build the pipeline based on what files are present
    this.pipeline = []

    // Symbol library stages (if symbol library file exists)
    if (this.ctx.kicadSymbolLib) {
      this.pipeline.push(
        new InitializeSymbolLibraryContextStage(this.ctx),
        new CollectSymbolLibrarySymbolsStage(this.ctx),
      )
    }

    // Schematic stages (if schematic file exists)
    if (this.ctx.kicadSch) {
      this.pipeline.push(
        new InitializeSchematicContextStage(this.ctx),
        new CollectLibrarySymbolsStage(this.ctx),
        new CollectSchematicTracesStage(this.ctx),
      )
    }

    // PCB stages (if PCB file exists)
    if (this.ctx.kicadPcb) {
      this.pipeline.push(
        new InitializePcbContextStage(this.ctx),
        new CollectNetsStage(this.ctx),
        new CollectFootprintsStage(this.ctx),
        new CollectSourceTracesStage(this.ctx),
        new CollectTracesStage(this.ctx),
        new CollectViasStage(this.ctx),
        new CollectZonesStage(this.ctx),
        new CollectGraphicsStage(this.ctx),
      )
    }
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
