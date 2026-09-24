import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { parseKicadPcb } from "kicadts"
import { convertKicadPcbToSvgSnapshot } from "../../fixtures/svg-snapshot-test-utils"

test("GMSL serializer preserves footprint rotations on both board sides", () => {
  const circuitJson = convertKicadPcbToSvgSnapshot({
    kicadPcbPath: "tests/assets/gmsl-serializer.kicad_pcb",
    kicadFileName: "gmsl-serializer.kicad_pcb",
    testPath: import.meta.path,
    snapshotName: "gmsl-serializer-circuit-json",
  })

  const sourceNames = Object.fromEntries(
    circuitJson
      .filter((element) => element.type === "source_component")
      .map((component) => [component.source_component_id, component.name]),
  )
  const components = circuitJson.filter(
    (element) => element.type === "pcb_component",
  )
  const board = parseKicadPcb(
    readFileSync("tests/assets/gmsl-serializer.kicad_pcb", "utf8"),
  )
  expect(components).toHaveLength(118)
  expect(
    components.map((component) => ({
      reference: sourceNames[component.source_component_id],
      layer: component.layer,
      rotation: component.rotation,
    })),
  ).toEqual(
    board.footprints.map((footprint) => ({
      reference: footprint.properties.find(
        (property) => property.key === "Reference",
      )?.value,
      layer: footprint.layer?.getString().includes("B.Cu") ? "bottom" : "top",
      rotation:
        footprint.position && "angle" in footprint.position
          ? (footprint.position.angle ?? 0)
          : 0,
    })),
  )

  // KiCad pad 1 is (-1.101, 0.949) on Y1 and (-0.48, 0) on C28.
  // Both footprints are at +45 degrees; reflect Y after placing the pad.
  for (const [reference, layer, dx, dy] of [
    ["Y1", "top", -0.152 / Math.SQRT2, -2.05 / Math.SQRT2],
    ["C28", "bottom", -0.48 / Math.SQRT2, -0.48 / Math.SQRT2],
  ] as const) {
    const component = components.find(
      (candidate) => sourceNames[candidate.source_component_id] === reference,
    )
    if (!component) throw new Error(`Missing component ${reference}`)
    expect(component).toMatchObject({ layer, rotation: 45 })
    const pad = circuitJson.find(
      (element) =>
        element.type === "pcb_smtpad" &&
        element.pcb_component_id === component.pcb_component_id &&
        element.port_hints?.includes("1"),
    )
    if (pad?.type !== "pcb_smtpad" || pad.shape !== "rotated_rect") {
      throw new Error(`Expected a rotated rectangular pad at ${reference}.1`)
    }
    expect(pad.x - component.center.x).toBeCloseTo(dx, 8)
    expect(pad.y - component.center.y).toBeCloseTo(dy, 8)
    expect(pad).toMatchObject({ layer, ccw_rotation: 45 })
  }
})
