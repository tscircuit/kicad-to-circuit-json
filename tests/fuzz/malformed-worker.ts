// One input per process: parent enforces a hard wall-clock and output limit.
import { readFileSync } from "node:fs"
import {
  KicadToCircuitJsonConverter,
  KicadFootprintToCircuitJsonConverter,
  KicadSymbolToCircuitJsonConverter,
} from "../../lib"
import { validate, extensions } from "./harness"
import type { Mode } from "./generators"
const { mode, input } = JSON.parse(readFileSync(0, "utf8")) as {
  mode: Mode
  input: string
}
const converter =
  mode === "footprint"
    ? new KicadFootprintToCircuitJsonConverter()
    : mode === "symbol"
      ? new KicadSymbolToCircuitJsonConverter()
      : new KicadToCircuitJsonConverter()
converter.addFile(`fuzz.kicad_${extensions[mode]}`, input)
try {
  converter.runUntilFinished()
} catch (error) {
  // Runtime programmer errors, stack overflows and process death are failures.
  if (
    !(error instanceof Error) ||
    (error.constructor !== Error && !(error instanceof SyntaxError))
  )
    throw error
  process.stdout.write(
    JSON.stringify({
      status: "rejected",
      message: error.message.slice(0, 500),
    }),
  )
  process.exit(0)
}
validate(converter.getOutput())
process.stdout.write(
  JSON.stringify({ status: "accepted", count: converter.getOutput().length }),
)
