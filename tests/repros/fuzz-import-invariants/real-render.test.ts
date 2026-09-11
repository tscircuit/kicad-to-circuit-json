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
  CIRCUIT_TO_SVG_VERSION,
} from "./real-render"
const hash = (v: Buffer | string) =>
  createHash("sha256").update(v).digest("hex")
const update = process.env.UPDATE_IMPORT_REPRO_SNAPSHOTS === "1"
const updateKicad = process.env.UPDATE_KICAD_REFERENCES === "1"

for (const name of renderCases) {
  test(`real KiCad / Circuit JSON render: ${name}`, async () => {
    const path = (suffix: string) => join(renderDir, `${name}.${suffix}`)
    if (update) mkdirSync(renderDir, { recursive: true })
    if (updateKicad) {
      if (!update)
        throw new Error(
          "Reference regeneration requires UPDATE_IMPORT_REPRO_SNAPSHOTS=1",
        )
      const version = exportKicad(name, path("kicad.svg"))
      writeFileSync(path("kicad-version.txt"), version + "\n")
      writeFileSync(
        path("kicad.png"),
        await pngFromSvg(readFileSync(path("kicad.svg"), "utf8"), name),
      )
    }
    expect(
      existsSync(path("kicad.svg")),
      "Generate a genuine KiCad reference before committing",
    ).toBe(true)
    const { svg, circuitJson } = circuitRender(name)
    const json = JSON.stringify(circuitJson, null, 2) + "\n"
    if (update) {
      const png = await pngFromSvg(svg, name)
      writeFileSync(path("circuit-json.svg"), svg)
      writeFileSync(path("circuit-json.png"), png)
      writeFileSync(path("circuit.json"), json)
      writeFileSync(
        path("comparison.png"),
        await comparePngs(readFileSync(path("kicad.png")), png, name),
      )
      const assets = [
        "kicad.svg",
        "kicad.png",
        "circuit-json.svg",
        "circuit-json.png",
        "comparison.png",
        "circuit.json",
      ]
      writeFileSync(
        path("provenance.json"),
        JSON.stringify(
          {
            inputSha256: hash(readFileSync(fixturePath(name))),
            kicadVersion: readFileSync(
              path("kicad-version.txt"),
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
    expect(svg).toBe(readFileSync(path("circuit-json.svg"), "utf8"))
    expect(json).toBe(readFileSync(path("circuit.json"), "utf8"))
    const provenance = JSON.parse(readFileSync(path("provenance.json"), "utf8"))
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
