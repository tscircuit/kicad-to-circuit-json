import { cju } from "@tscircuit/circuit-json-util"
import type { ConverterContext, ConverterStage } from "./types"
import { parseKicadPcb, parseKicadSch } from "kicadts"

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
    if (filesWithExtension.length !== 1) {
      throw new Error(
        `Expected 1 file with extension ${extension}, got ${filesWithExtension.length}. Files: ${filesWithExtension.join(", ")}`,
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
    }

    this.pipeline = []
  }

  step() {
    if (!this.pipeline) {
      this.initializePipeline()
    }
  }
}
