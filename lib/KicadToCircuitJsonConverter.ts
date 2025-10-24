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

  initializePipeline() {
    this.ctx = {
      // TODO
    }

    this.pipeline = []
  }

  step() {
    if (!this.pipeline) {
      this.initializePipeline()
    }
  }
}
