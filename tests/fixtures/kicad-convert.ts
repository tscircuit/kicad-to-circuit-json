import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../lib"

export function convertKicadPcbToCircuitJson(kicadPcbPath: string) {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    kicadPcbPath.split("/").pop()!,
    readFileSync(kicadPcbPath, "utf-8"),
  )
  converter.runUntilFinished()
  return converter.getOutput() as any[]
}
