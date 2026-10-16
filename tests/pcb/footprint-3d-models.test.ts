import { expect, test } from "bun:test"
import { pcb_component } from "circuit-json"
import {
  KicadFootprintToCircuitJsonConverter,
  KicadToCircuitJsonConverter,
} from "../../lib"

function convertFootprint(
  content: string,
  kind: "board" | "footprint" = "board",
  layer = "F.Cu",
) {
  const footprint = `(footprint "Test:3DModel"
    (layer "${layer}")
    (uuid "62511c4b-c84a-4f5e-a395-fd23b19a3b41")
    (at 120 110 90)
    (property "Reference" "U1" (at 0 -2) (layer "F.SilkS")
      (effects (font (size 1 1))))
    ${content}
  )`
  const converter =
    kind === "board"
      ? new KicadToCircuitJsonConverter()
      : new KicadFootprintToCircuitJsonConverter()
  converter.addFile(
    kind === "board" ? "model.kicad_pcb" : "model.kicad_mod",
    kind === "board"
      ? `(kicad_pcb (version 20241229) (generator "pcbnew") ${footprint})`
      : footprint,
  )
  converter.runUntilFinished()
  // Validate the serialized output so model metadata must be plain Circuit JSON.
  const output = JSON.parse(converter.getOutputString())
  const component = pcb_component.parse(
    output.find(
      (element: { type: string }) => element.type === "pcb_component",
    ),
  )
  return { component, warnings: converter.getWarnings() }
}

for (const kind of ["board", "footprint"] as const) {
  test.each([
    "step",
    "wrl",
  ])(`${kind} import preserves a %s model path and local transforms`, (extension) => {
    const path = `\${KICAD9_3DMODEL_DIR}/Test.3dshapes/model.${extension}`
    const { component, warnings } = convertFootprint(
      `(model "${path}"
          (offset (xyz 2 -3 4))
          (scale (xyz 1.25 1.3 1.1))
          (rotate (xyz 10 -20 -180)))`,
      kind,
      "B.Cu",
    )

    expect(component.layer).toBe("bottom")
    expect(component.rotation).toBe(90)
    expect(component.metadata?.kicad_footprint).toEqual({
      model: {
        path,
        offset: { x: 2, y: -3, z: 4 },
        scale: { x: 1.25, y: 1.3, z: 1.1 },
        rotate: { x: 10, y: -20, z: -180 },
      },
    })
    expect(warnings).toEqual([])
  })
}

test("preserves a relative model path without inventing optional transforms", () => {
  const { component, warnings } = convertFootprint(
    '(model "../models/custom part.STEP")',
  )
  expect(component.metadata?.kicad_footprint?.model).toEqual({
    path: "../models/custom part.STEP",
  })
  expect(warnings).toEqual([])
})

test("preserves model metadata alongside assembly exclusions", () => {
  const { component } = convertFootprint(`
    (attr smd exclude_from_pos_files exclude_from_bom)
    (model "model.step")
  `)
  expect(component.metadata?.kicad_footprint).toEqual({
    attributes: { exclude_from_pos_files: true, exclude_from_bom: true },
    model: { path: "model.step" },
  })
})

test("does not add metadata to footprints without models or exclusions", () => {
  const { component, warnings } = convertFootprint("(attr smd)")
  expect(component.metadata).toBeUndefined()
  expect(warnings).toEqual([])
})

test("retains the first model and warns when additional models cannot be represented", () => {
  const { component, warnings } = convertFootprint(`
    (model "first.step")
    (model "second.wrl")
    (model "third.step")
  `)
  expect(component.metadata?.kicad_footprint?.model).toEqual({
    path: "first.step",
  })
  expect(warnings).toEqual([
    "Footprint U1: Circuit JSON KiCad footprint metadata supports one 3D model; 2 additional model(s) were not imported.",
  ])
})
