import { test } from "bun:test"
import { readFileSync } from "node:fs"
import { KicadToCircuitJsonConverter } from "../../lib"
import {
  expectCircuitJsonConnectivityMatchesKicadGencad,
  hasKicadCli,
} from "../fixtures/kicad-gencad-netlist"

const kicadCliTest = hasKicadCli() ? test : test.skip

function convertPcb(kicadPcbPath: string) {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    kicadPcbPath.split("/").pop()!,
    readFileSync(kicadPcbPath, "utf-8"),
  )
  converter.runUntilFinished()
  return converter.getOutput() as any[]
}

kicadCliTest(
  "OV9281 source connectivity exactly matches KiCad Gencad netlist",
  () => {
    const kicadPcbPath =
      "tests/repros/ov9281-dual-camera-board/ov9281-dual-camera-board.kicad_pcb"

    expectCircuitJsonConnectivityMatchesKicadGencad({
      kicadPcbPath,
      circuitJson: convertPcb(kicadPcbPath),
    })
  },
)

kicadCliTest(
  "OV5640 source connectivity exactly matches KiCad Gencad netlist",
  () => {
    const kicadPcbPath =
      "tests/repros/OV5640-dual-camera-board/OV5640-dual-camera-board.kicad_pcb"

    expectCircuitJsonConnectivityMatchesKicadGencad({
      kicadPcbPath,
      circuitJson: convertPcb(kicadPcbPath),
    })
  },
)
