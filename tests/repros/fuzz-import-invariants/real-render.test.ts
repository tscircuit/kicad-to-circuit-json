import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { collectEvidence } from "./evidence"
import {
  circuitRender,
  exportKicad,
  pngFromSvg,
  comparePngs,
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

for (const name of renderCases) {
  test(`real KiCad / Circuit JSON render: ${name}`, async () => {
    const path = (suffix: string) => join(renderDir, `${name}.${suffix}`)
    const reference = (suffix: string) =>
      join(referenceDir, `${name}.${suffix}`)
    if (update) mkdirSync(renderDir, { recursive: true })
    if (updateKicad) {
      if (!update)
        throw new Error(
          "Reference regeneration requires UPDATE_IMPORT_REPRO_SNAPSHOTS=1",
        )
      mkdirSync(referenceDir, { recursive: true })
      const version = exportKicad(name, reference("kicad.svg"))
      writeFileSync(reference("kicad-version.txt"), version + "\n")
    }
    expect(
      existsSync(reference("kicad.svg")),
      "Generate a genuine KiCad reference before committing",
    ).toBe(true)
    const { svg, circuitJson } = circuitRender(name)
    const json = JSON.stringify(circuitJson, null, 2) + "\n"
    if (update) {
      const png = await pngFromSvg(svg, name)
      writeFileSync(path("circuit.json"), json)
      writeFileSync(
        path("comparison.png"),
        await comparePngs(
          await pngFromSvg(readFileSync(reference("kicad.svg"), "utf8"), name),
          png,
          name,
        ),
      )
      const assets = ["comparison.png", "circuit.json"]
      writeFileSync(
        path("provenance.json"),
        JSON.stringify(
          {
            kicadSvgSha256: hash(readFileSync(reference("kicad.svg"))),
            circuitSvgSha256: hash(svg),
            inputSha256: hash(readFileSync(fixturePath(name))),
            kicadVersion: readFileSync(
              reference("kicad-version.txt"),
              "utf8",
            ).trim(),
            circuitToSvgVersion: CIRCUIT_TO_SVG_VERSION,
            sha256: Object.fromEntries(
              assets.map((suffix) => [
                suffix,
                hash(readFileSync(path(suffix))),
              ]),
            ),
          },
          null,
          2,
        ) + "\n",
      )
    }
    expect(json).toBe(readFileSync(path("circuit.json"), "utf8"))
    const provenance = JSON.parse(readFileSync(path("provenance.json"), "utf8"))
    expect(hash(svg)).toBe(provenance.circuitSvgSha256)
    expect(hash(readFileSync(reference("kicad.svg")))).toBe(
      provenance.kicadSvgSha256,
    )
    expect(provenance.inputSha256).toBe(hash(readFileSync(fixturePath(name))))
    for (const [suffix, expected] of Object.entries(
      provenance.sha256 as Record<string, string>,
    ))
      expect(hash(readFileSync(path(suffix)))).toBe(expected)
  })
}

// A new defect must get a native renderer comparison, not just a JSON record.
test("every defect snapshot has a KiCad / Circuit JSON comparison", () => {
  for (const entry of collectEvidence())
    expect([...renderCases] as string[]).toContain(entry.name)
})
