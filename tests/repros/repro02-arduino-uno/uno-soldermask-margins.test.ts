import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { parseKicadPcb } from "kicadts"
import { KicadToCircuitJsonConverter } from "../../../lib"

test("Arduino Uno keeps explicit pad solder mask margins", () => {
  const source = readFileSync(
    "tests/repros/repro02-arduino-uno/arduino-uno.source.kicad_pcb",
    "utf8",
  )
  const sourcePads = parseKicadPcb(source).footprints.flatMap((footprint) => {
    const reference = footprint.properties.find(
      (property) => property.key === "Reference",
    )?.value
    return footprint.fpPads.flatMap((pad) =>
      pad.solderMaskMargin === undefined
        ? []
        : [[`${reference}:${pad.number}`, pad.solderMaskMargin] as const],
    )
  })

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("arduino-uno.kicad_pcb", source)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const sourceNames = new Map(
    circuitJson
      .filter((element) => element.type === "source_component")
      .map((component) => [component.source_component_id, component.name]),
  )
  const componentNames = new Map(
    circuitJson
      .filter((element) => element.type === "pcb_component")
      .map((component) => [
        component.pcb_component_id,
        sourceNames.get(component.source_component_id),
      ]),
  )
  const importedPads = circuitJson
    .filter((element) => element.type === "pcb_smtpad")
    .flatMap((pad) =>
      pad.soldermask_margin === undefined
        ? []
        : [
            [
              `${componentNames.get(pad.pcb_component_id)}:${pad.port_hints?.[0] ?? ""}`,
              pad.soldermask_margin,
            ] as const,
          ],
    )

  expect(sourcePads).toHaveLength(12)
  expect(importedPads.sort()).toEqual(sourcePads.sort())
}, 30_000)
