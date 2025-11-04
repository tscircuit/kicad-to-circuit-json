import { cju } from "@tscircuit/circuit-json-util"
import type { ConverterContext, ConverterStage } from "./types"
import { parseKicadPcb, parseKicadSch } from "kicadts"

// Import schematic stages
import { InitializeSchematicContextStage } from "./stages/schematic/InitializeSchematicContextStage"
import { CollectLibrarySymbolsStage } from "./stages/schematic/CollectLibrarySymbolsStage"
import { CollectSchematicTracesStage } from "./stages/schematic/CollectSchematicTracesStage"

// Import PCB stages
import { InitializePcbContextStage } from "./stages/pcb/InitializePcbContextStage"
import { CollectNetsStage } from "./stages/pcb/CollectNetsStage"
import { CollectFootprintsStage } from "./stages/pcb/CollectFootprintsStage"
import { CollectTracesStage } from "./stages/pcb/CollectTracesStage"
import { CollectViasStage } from "./stages/pcb/CollectViasStage"
import { CollectGraphicsStage } from "./stages/pcb/CollectGraphicsStage"
import { CollectSourceTracesStage } from "./stages/pcb/CollectSourceTracesStage"

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

    this.ctx = {
      db: cju([]),
      kicadPcb: pcbFile ? parseKicadPcb(this.fsMap[pcbFile]!) : undefined,
      kicadSch: schFile ? parseKicadSch(this.fsMap[schFile]!) : undefined,
      warnings: [],
      stats: {},
    }

    // Build the pipeline based on what files are present
    this.pipeline = []

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
        new CollectTracesStage(this.ctx),
        new CollectViasStage(this.ctx),
        new CollectGraphicsStage(this.ctx),
        new CollectSourceTracesStage(this.ctx),
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

  getOutput() {
    if (!this.ctx) {
      this.initializePipeline()
      this.runUntilFinished()
    }

    // Convert the database to a plain array of Circuit JSON elements
    const elements: any[] = []

    // Known table names in circuit-json-util
    const tableNames = [
      "source_component",
      "source_port",
      "source_trace",
      "schematic_component",
      "schematic_port",
      "schematic_trace",
      "schematic_net_label",
      "pcb_component",
      "pcb_port",
      "pcb_smtpad",
      "pcb_plated_hole",
      "pcb_hole",
      "pcb_trace",
      "pcb_via",
      "pcb_board",
      "pcb_silkscreen_text",
      "pcb_silkscreen_path",
    ]

    // Collect all elements from different tables
    for (const tableName of tableNames) {
      const table = (this.ctx!.db as any)[tableName]
      if (table && typeof table.list === "function") {
        const items = table.list()
        if (items && Array.isArray(items)) {
          elements.push(...items)
        }
      }
    }

    return elements
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
