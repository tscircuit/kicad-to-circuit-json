import { cju } from "@tscircuit/circuit-json-util"
import type { AnyCircuitElement } from "circuit-json"
import { type Footprint, parseKicadMod } from "kicadts"
import { compose, scale, translate } from "transformation-matrix"
import { processFootprint } from "./stages/pcb/CollectFootprintsStage/process-footprint"
import type { ConverterContext } from "./types"

export class KicadFootprintToCircuitJsonConverter {
  fsMap: Record<string, string> = {}
  ctx?: ConverterContext

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

  private initializeContext() {
    const footprintFile = this._findFileWithExtension(".kicad_mod")
    if (!footprintFile) {
      throw new Error("No .kicad_mod file was added to the converter")
    }

    const footprint = parseKicadMod(this.fsMap[footprintFile]!)
    const position = footprint.position
    const footprintOrigin = {
      x: position?.x ?? 0,
      y: position?.y ?? 0,
    }

    this.ctx = {
      db: cju([]),
      k2cMatPcb: compose(
        scale(1, -1),
        translate(-footprintOrigin.x, -footprintOrigin.y),
      ),
      footprintUuidToComponentId: new Map(),
      footprintUuidToSourceComponentId: new Map(),
      warnings: [],
      stats: {},
      standaloneFootprintConversion: true,
    }

    processFootprint(this.ctx, this.ensureFootprintUuid(footprint))
  }

  private ensureFootprintUuid(footprint: Footprint): Footprint {
    if (footprint.uuid?.value || footprint.tstamp?.value) {
      return footprint
    }

    ;(footprint as any).tstamp = { value: "standalone-footprint" }
    return footprint
  }

  runUntilFinished() {
    if (!this.ctx) {
      this.initializeContext()
    }
  }

  getOutput(): AnyCircuitElement[] {
    if (!this.ctx) {
      this.initializeContext()
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
