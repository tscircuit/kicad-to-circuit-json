import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { KicadFootprintToCircuitJsonConverter } from "../lib"

test("kicad footprint converter: converts a standalone .kicad_mod footprint", () => {
  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile(
    "DIP-10_W10.16mm.kicad_mod",
    readFileSync("tests/assets/DIP-10_W10.16mm.kicad_mod", "utf8"),
  )
  converter.runUntilFinished()

  const output = converter.getOutput()
  const sourceComponent = output.find((el: any) => el.type === "source_component")
  const pcbComponent = output.find((el: any) => el.type === "pcb_component")
  const platedHoles = output.filter((el: any) => el.type === "pcb_plated_hole")
  const holesByHint = Object.fromEntries(
    platedHoles.map((hole: any) => [hole.port_hints?.[0], hole]),
  )

  expect(sourceComponent).toMatchObject({
    type: "source_component",
    name: "REF**",
    ftype: "simple_chip",
  })

  expect(pcbComponent).toMatchObject({
    type: "pcb_component",
    layer: "top",
    center: { x: 0, y: 0 },
  })
  expect(Math.abs((pcbComponent as any).rotation ?? 0)).toBe(0)

  expect(platedHoles).toHaveLength(10)
  expect(holesByHint["1"]).toMatchObject({
    shape: "circular_hole_with_rect_pad",
    hole_diameter: 0.8,
    rect_pad_width: 1.6,
    rect_pad_height: 1.6,
    x: 0,
    y: 0,
  })
  expect(holesByHint["5"]).toMatchObject({
    shape: "circle",
    hole_diameter: 0.8,
    outer_diameter: 1.6,
    x: 0,
    y: -10.16,
  })
  expect(holesByHint["10"]).toMatchObject({
    shape: "circle",
    hole_diameter: 0.8,
    outer_diameter: 1.6,
    x: 10.16,
    y: 0,
  })

  expect(converter.getWarnings()).toEqual([])
  expect(converter.getStats()).toMatchObject({ components: 1, pads: 10 })
})

test("kicad footprint converter: DIP-10 SVG snapshot", async () => {
  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile(
    "DIP-10_W10.16mm.kicad_mod",
    readFileSync("tests/assets/DIP-10_W10.16mm.kicad_mod", "utf8"),
  )

  const output = converter.getOutput()
  const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
  const svg = convertCircuitJsonToPcbSvg(output as any, {
    showCourtyards: true,
  })

  await mkdir("tests/__snapshots__", { recursive: true })
  await writeFile(
    "tests/__snapshots__/DIP-10_W10.16mm-circuit-json.svg",
    svg,
  )

  expect(svg.length).toBeGreaterThan(0)
})
