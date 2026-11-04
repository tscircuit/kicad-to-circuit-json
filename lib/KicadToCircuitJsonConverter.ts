import { cju } from "@tscircuit/circuit-json-util"
import type { AnyCircuitElement } from "circuit-json"
import { parseKicadPcb, parseKicadSym, type SxClass } from "kicadts"
import {
  loadSchematicProject,
  normalizeProjectPath,
} from "./schematic-project/load-schematic-project"
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
import { CollectSchematicAnnotationsStage } from "./stages/schematic/CollectSchematicAnnotationsStage"
import { CollectSchematicTracesStage } from "./stages/schematic/CollectSchematicTracesStage"
import {
  CollectSchematicProjectConnectivityStage,
  type ProjectSheetContext,
} from "./stages/schematic/CollectSchematicProjectConnectivityStage"
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
  private rootSchematicPath?: string
  private resolvedRootSchematicPath?: string

  get currentStage() {
    return this.pipeline?.[this.currentStageIndex]
  }

  addFile(filePath: string, content: string) {
    this.fsMap[normalizeProjectPath(filePath)] = content
  }

  setRootSchematic(filePath: string) {
    if (this.pipeline)
      throw new Error("Select the root schematic before starting conversion.")
    this.rootSchematicPath = normalizeProjectPath(filePath)
  }

  getRootSchematicPath() {
    return this.resolvedRootSchematicPath ?? this.rootSchematicPath
  }

  _findFileWithExtension(extension: string) {
    const filesWithExtension = Object.keys(this.fsMap).filter((key) =>
      key.toLowerCase().endsWith(extension),
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
    const project = loadSchematicProject(this.fsMap, this.rootSchematicPath)
    this.resolvedRootSchematicPath = project?.rootFilePath
    const symbolLibFile = this._findFileWithExtension(".kicad_sym")

    this.ctx = {
      db: cju([]),
      kicadPcb: pcbFile ? parseKicadPcb(this.fsMap[pcbFile]!) : undefined,
      kicadSch: project?.instances[0]?.schematic,
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
    if (project) {
      const isHierarchical =
        project.instances.length > 1 ||
        project.instances.some(
          (instance) => instance.hierarchicalLabels.length > 0,
        )
      let maxX = 150
      let maxExtent = 0
      const measure = (node: SxClass) => {
        if ("x" in node && typeof node.x === "number")
          maxX = Math.max(maxX, Math.abs(node.x))
        if ("width" in node && typeof node.width === "number")
          maxExtent = Math.max(maxExtent, Math.abs(node.width))
        if ("radius" in node && typeof node.radius === "number")
          maxExtent = Math.max(maxExtent, Math.abs(node.radius))
        for (const child of node.getChildren()) measure(child)
      }
      for (const instance of project.instances) {
        measure(instance.schematic)
        for (const label of instance.hierarchicalLabels) measure(label)
      }
      const spacing = (2 * (maxX + maxExtent) + 100) / 15
      const references = new Map<string, string>()
      const sourcePortIds = new Map<string, string>()
      const sheets: ProjectSheetContext[] = project.instances.map(
        (instance, index) => ({
          instance,
          ctx: isHierarchical
            ? {
                ...this.ctx!,
                kicadSch: instance.schematic,
                schematicInstancePath: instance.instancePath,
                schematicOffsetX: index * spacing,
                schematicHierarchicalLabels: instance.hierarchicalLabels,
                schematicNetIds: new Map(),
                schematicWireTraceIds: new Map(),
                schematicReferenceToSourceComponentId: references,
                schematicSourcePortIds: sourcePortIds,
              }
            : this.ctx!,
        }),
      )
      for (const sheet of sheets) {
        this.pipeline.push(
          new InitializeSchematicContextStage(sheet.ctx),
          new CollectLibrarySymbolsStage(sheet.ctx),
          new CollectSchematicTracesStage(sheet.ctx),
        )
      }
      if (isHierarchical)
        this.pipeline.push(
          new CollectSchematicProjectConnectivityStage(this.ctx, sheets),
        )
      for (const sheet of sheets) {
        this.pipeline.push(new CollectSchematicAnnotationsStage(sheet.ctx))
      }
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
