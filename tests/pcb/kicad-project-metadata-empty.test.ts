import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../../lib"

test("unused project settings survive a board with no nets", () => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "empty.kicad_pcb",
    '(kicad_pcb (version 20240108) (generator "pcbnew") (layers (0 "F.Cu" signal) (31 "B.Cu" signal)))',
  )
  const settings = { classes: [{ name: "Unused", track_width: 0.7 }] }
  converter.addFile(
    "empty.kicad_pro",
    JSON.stringify({ net_settings: settings }),
  )
  converter.runUntilFinished()
  expect(
    converter
      .getOutput()
      .find((element) => element.type === "source_project_metadata")?.metadata
      ?.kicad_project?.net_settings,
  ).toEqual(settings)
  expect(
    converter.getOutput().filter((element) => element.type === "source_net"),
  ).toEqual([])
})
