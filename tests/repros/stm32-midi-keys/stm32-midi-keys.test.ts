import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../../../lib"

// kicadts throws: Class "mode" not registered for parent "fill".
// Remove .failing after updating to a parser release with hatch fill support.
test.failing("imports the full STM32 MIDI keys board with hatched copper", async () => {
  const pcbContent = await Bun.file(
    `${import.meta.dir}/stm32_midi_keys.kicad_pcb`,
  ).text()
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("stm32_midi_keys.kicad_pcb", pcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  expect(
    circuitJson.filter((element) => element.type === "pcb_component"),
  ).toHaveLength(86)
  expect(
    circuitJson.filter((element) => element.type === "pcb_via"),
  ).toHaveLength(124)
  expect(
    circuitJson.filter((element) => element.type === "pcb_copper_pour"),
  ).toHaveLength(29)
})
