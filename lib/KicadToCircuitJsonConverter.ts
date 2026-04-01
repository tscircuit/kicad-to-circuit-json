import { cju } from "@tscircuit/circuit-json-util"
import { parseKicadPcb, parseKicadSch, parseKicadSexpr } from "kicadts"
import * as kicadts from "kicadts"

// Inject native KiCad V9 S-Expression Primitive Class Bindings into the upstream parser
const SxClass = Object.getPrototypeOf((kicadts as any).Polyline);
const missingTokens = [
  "rectangle", "polyline", "circle", "arc", "text", "symbol",
  "fill", "stroke", "beziers", "buses", "busEntries"
];
for (const token of missingTokens) {
  if (SxClass.classes && !SxClass.classes[token]) {
    class V9ExtensionPrimitive extends SxClass {
      static get token() { return token; }
      static fromSexprPrimitives(args: any[]) { 
        const inst = new this() as any;
        const { propertyMap, arrayPropertyMap } = SxClass.parsePrimitivesToClassProperties(args, token);
        Object.assign(inst, propertyMap);
        for (const [k, v] of Object.entries(arrayPropertyMap)) {
           if (v && (v as any).length > 1) {
             inst[k + "List"] = v;
           }
        }
        inst._rawArgs = args;
        return inst;
      }
      constructor(args: any = {}) { super(args); }
    }
    SxClass.classes[token] = V9ExtensionPrimitive;
  }
}

const OriginalSchematicSymbol = (kicadts as any).SchematicSymbol;
if (OriginalSchematicSymbol) {
  const origFromSexpr = OriginalSchematicSymbol.fromSexprPrimitives;
  OriginalSchematicSymbol.fromSexprPrimitives = function(args: any[]) {
    const inst = origFromSexpr.call(this, args);
    const { arrayPropertyMap } = (kicadts as any).SxClass.parsePrimitivesToClassProperties(args, "symbol");
    if (arrayPropertyMap.rectangle) inst.rectangles = arrayPropertyMap.rectangle;
    if (arrayPropertyMap.polyline) inst.polylines = arrayPropertyMap.polyline;
    if (arrayPropertyMap.circle) inst.circles = arrayPropertyMap.circle;
    if (arrayPropertyMap.arc) inst.arcs = arrayPropertyMap.arc;
    if (arrayPropertyMap.text) inst.texts = arrayPropertyMap.text;
    return inst;
  };
}
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

  _findFilesWithExtension(extension: string) {
    return Object.keys(this.fsMap).filter((key) => key.endsWith(extension));
  }

  initializePipeline() {
    const pcbFiles = this._findFilesWithExtension(".kicad_pcb")
    const schFiles = this._findFilesWithExtension(".kicad_sch")
    const symFiles = this._findFilesWithExtension(".kicad_sym")

    const pcbFile = pcbFiles[0] // still assume single pcb for now

    const parsedSymLibs = symFiles.map(file => parseKicadSexpr(this.fsMap[file]!)[0] as any)

    // Parse all sch files and merge symbols/traces into one giant logical kicadSch
    const kicadSchs = schFiles.map(file => parseKicadSch(this.fsMap[file]!))
    let mergedSch: any = undefined;
    if (kicadSchs.length > 0) {
      mergedSch = kicadSchs[0];
      
      // Inject external symbol libraries into the root schematic libSymbols
      for (const symLib of parsedSymLibs) {
        if (!mergedSch.libSymbols) {
          mergedSch.libSymbols = symLib;
        } else if (symLib.symbols) {
          mergedSch.libSymbols.symbols = [...(mergedSch.libSymbols.symbols || []), ...symLib.symbols];
        }
      }
      // Minimal merge of symbols and traces
      // Minimal merge of symbols and traces
      for (let i = 1; i < kicadSchs.length; i++) {
        const mergeArrays = [
          "symbols", "wires", "junctions", "buses", "busEntries", "beziers", 
          "labels", "global_labels", "hierarchical_labels", "no_connects"
        ];
        
        for (const arrName of mergeArrays) {
           if ((kicadSchs[i] as any)[arrName]) {
              (mergedSch as any)[arrName] = [
                 ...((mergedSch as any)[arrName] || []), 
                 ...(kicadSchs[i] as any)[arrName]
              ];
           }
        }
      }
    }

    this.ctx = {
      db: cju([]),
      kicadPcb: pcbFile ? parseKicadPcb(this.fsMap[pcbFile]!) : undefined,
      kicadSch: mergedSch,
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
      "schematic_box",
      "schematic_line",
      "schematic_text",
      "pcb_component",
      "pcb_port",
      "pcb_smtpad",
      "pcb_plated_hole",
      "pcb_hole",
      "pcb_trace",
      "pcb_via",
      "pcb_copper_pour",
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
