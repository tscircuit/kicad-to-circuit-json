import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type { PcbSmtPad } from "circuit-json"
import { KicadToCircuitJsonConverter } from "../../../lib"

test("USB-C power adapter C43 preserves its rotated pad clearance to TP5", () => {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "usb-c-power-adapter.kicad_pcb",
    readFileSync("tests/assets/usb-c-power-adapter.kicad_pcb", "utf8"),
  )
  converter.runUntilFinished()
  const output = converter.getOutput()

  const getPad = (name: string, pin: string): PcbSmtPad => {
    const source = output.find(
      (element) => element.type === "source_component" && element.name === name,
    )
    if (source?.type !== "source_component") throw new Error(`Missing ${name}`)
    const component = output.find(
      (element) =>
        element.type === "pcb_component" &&
        element.source_component_id === source.source_component_id,
    )
    if (component?.type !== "pcb_component")
      throw new Error(`Missing PCB ${name}`)
    const pad = output.find(
      (element) =>
        element.type === "pcb_smtpad" &&
        element.pcb_component_id === component.pcb_component_id &&
        element.port_hints?.includes(pin),
    )
    if (pad?.type !== "pcb_smtpad") throw new Error(`Missing ${name}.${pin}`)
    return pad
  }

  const c43 = getPad("C43", "1")
  const tp5 = getPad("TP5", "1")
  expect(c43).toMatchObject({ shape: "rect", width: 5.3, height: 2.5 })
  expect(tp5.shape).toBe("circle")
  if (c43.shape !== "rect" || tp5.shape !== "circle") {
    throw new Error("Expected C43 rectangle and TP5 circle")
  }

  // SRJ18 sample016: the old 2.5 x 5.3 rectangle put TP5's terminal
  // 0.375 mm inside foreign copper before routing even began.
  expect(c43.x).toBeCloseTo(-1.793115, 6)
  expect(c43.y).toBeCloseTo(-7.3403205, 6)
  expect(Math.abs(tp5.x - c43.x)).toBeLessThan(c43.width / 2)
  const copperGap = tp5.y - tp5.radius - (c43.y + c43.height / 2)
  expect(copperGap).toBeCloseTo(0.65, 6)
})
