import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { collectEvidence } from "./evidence"
import {
  circuitRender,
  exportKicad,
  compareSvgs,
  fixturePath,
  renderCases,
  renderDir,
  referenceDir,
  CIRCUIT_TO_SVG_VERSION,
} from "./real-render"
const hash = (v: Buffer | string) =>
  createHash("sha256").update(v).digest("hex")
const update = process.env.UPDATE_IMPORT_REPRO_SNAPSHOTS === "1"
const updateKicad = process.env.UPDATE_KICAD_REFERENCES === "1"
const assetDir = join(import.meta.dir, "assets")

for (const name of renderCases) {
  test(`real KiCad / Circuit JSON render: ${name}`, () => {
    const assertion = (suffix: string) => join(assetDir, `${name}.${suffix}`)
    const reference = (suffix: string) =>
      join(referenceDir, `${name}.${suffix}`)
    const snapshot = join(renderDir, `${name}.comparison.svg`)
    if (update) {
      mkdirSync(renderDir, { recursive: true })
      mkdirSync(assetDir, { recursive: true })
    }
    if (updateKicad) {
      if (!update)
        throw new Error(
          "Reference regeneration requires UPDATE_IMPORT_REPRO_SNAPSHOTS=1",
        )
      mkdirSync(referenceDir, { recursive: true })
      const version = exportKicad(name, reference("kicad.svg"))
      writeFileSync(reference("kicad-version.txt"), version + "\n")
    }
    const nativeSvg = readFileSync(reference("kicad.svg"), "utf8")
    const { svg, circuitJson } = circuitRender(name)
    const comparison = compareSvgs(nativeSvg, svg, name)
    const json = JSON.stringify(circuitJson, null, 2) + "\n"
    const provenance =
      JSON.stringify(
        {
          inputSha256: hash(readFileSync(fixturePath(name))),
          kicadSvgSha256: hash(nativeSvg),
          circuitSvgSha256: hash(svg),
          kicadVersion: readFileSync(
            reference("kicad-version.txt"),
            "utf8",
          ).trim(),
          circuitToSvgVersion: CIRCUIT_TO_SVG_VERSION,
        },
        null,
        2,
      ) + "\n"
    if (update) {
      writeFileSync(snapshot, comparison)
      writeFileSync(assertion("circuit.json"), json)
      writeFileSync(assertion("provenance.json"), provenance)
    }
    expect(comparison).toBe(readFileSync(snapshot, "utf8"))
    expect(json).toBe(readFileSync(assertion("circuit.json"), "utf8"))
    expect(provenance).toBe(readFileSync(assertion("provenance.json"), "utf8"))
  })
}

test("every visual defect has a paired comparison and snapshots contain only SVGs", () => {
  for (const entry of collectEvidence().filter(
    (entry) => entry.kind !== "anchor",
  ))
    expect([...renderCases] as string[]).toContain(entry.name)
  const files = readdirSync(join(import.meta.dir, "__snapshots__"), {
    recursive: true,
    withFileTypes: true,
  }).filter((entry) => entry.isFile())
  expect(files).toHaveLength(renderCases.length)
  expect(files.every((entry) => entry.name.endsWith(".comparison.svg"))).toBe(
    true,
  )
})
