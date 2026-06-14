import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { KicadFootprintToCircuitJsonConverter } from "../lib/KicadFootprintToCircuitJsonConverter"

function convertFootprint(assetName: string) {
  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile(
    assetName,
    readFileSync(`tests/assets/${assetName}`, "utf8"),
  )
  converter.runUntilFinished()
  return converter.getOutput() as any[]
}

function getPathBounds(path: any) {
  const xs = path.route.map((point: any) => point.x)
  const ys = path.route.map((point: any) => point.y)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
    centerY: (Math.min(...ys) + Math.max(...ys)) / 2,
    radius: (Math.max(...xs) - Math.min(...xs)) / 2,
  }
}

function expectPinOneSilkscreenDot(
  output: any[],
  expectedCenterX: number,
  expectedRadius: number,
) {
  const silkscreenPaths = output.filter(
    (el: any) => el.type === "pcb_silkscreen_path" && el.layer === "top",
  )
  const dotPath = silkscreenPaths.find((path: any) => {
    if (!Array.isArray(path.route) || path.route.length < 8) return false
    const bounds = getPathBounds(path)
    return (
      Math.abs(bounds.centerX - expectedCenterX) < 1e-6 &&
      Math.abs(bounds.centerY) < 1e-6
    )
  })

  expect(dotPath).toBeDefined()
  expect(dotPath.stroke_width).toBe(0.1)

  const bounds = getPathBounds(dotPath)
  expect(bounds.centerX).toBeCloseTo(expectedCenterX, 6)
  expect(bounds.centerY).toBeCloseTo(0, 6)
  expect(bounds.radius).toBeCloseTo(expectedRadius, 6)

  const pads = output.filter((el: any) => el.type === "pcb_smtpad")
  const padOne = pads.find((pad: any) => pad.port_hints?.includes("1"))
  const padTwo = pads.find((pad: any) => pad.port_hints?.includes("2"))
  expect(padOne).toBeDefined()
  expect(padTwo).toBeDefined()
  expect(pads.some((pad: any) => pad.port_hints?.includes("0"))).toBe(false)
  expect(bounds.centerX).toBeLessThan(padOne.x)
}

test("kicad footprint converter: converts a standalone .kicad_mod footprint", () => {
  const converter = new KicadFootprintToCircuitJsonConverter()
  converter.addFile(
    "DIP-10_W10.16mm.kicad_mod",
    readFileSync("tests/assets/DIP-10_W10.16mm.kicad_mod", "utf8"),
  )
  converter.runUntilFinished()

  const output = converter.getOutput()
  const sourceComponent = output.find(
    (el: any) => el.type === "source_component",
  )
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
  await writeFile("tests/__snapshots__/DIP-10_W10.16mm-circuit-json.svg", svg)

  expect(svg.length).toBeGreaterThan(0)
})

test("kicad footprint converter: diode SVG snapshots include pin-1 silkscreen circles", async () => {
  const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
  await mkdir("tests/__snapshots__", { recursive: true })

  for (const assetName of [
    "D_0201_0603Metric.kicad_mod",
    "D_0402_1005Metric.kicad_mod",
  ]) {
    const output = convertFootprint(assetName)
    const svg = convertCircuitJsonToPcbSvg(output as any, {
      showCourtyards: true,
    })
    const snapshotName = assetName.replace(".kicad_mod", "-circuit-json.svg")

    await writeFile(`tests/__snapshots__/${snapshotName}`, svg)

    expect(svg).toContain('data-type="pcb_silkscreen_path"')
    expect(svg).toContain('class="pcb-silkscreen pcb-silkscreen-top"')
  }
})

test("kicad footprint converter: preserves D_0201_0603Metric F.SilkS pin-1 circle", () => {
  const output = convertFootprint("D_0201_0603Metric.kicad_mod")
  expectPinOneSilkscreenDot(output, -0.86, 0.05)
})

test("kicad footprint converter: preserves D_0402_1005Metric F.SilkS pin-1 circle", () => {
  const output = convertFootprint("D_0402_1005Metric.kicad_mod")
  expectPinOneSilkscreenDot(output, -1.09, 0.05)
})
