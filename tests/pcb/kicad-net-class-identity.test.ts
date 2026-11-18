import { expect, test } from "bun:test"
import "bun-match-svg"
import { KicadToCircuitJsonConverter } from "../../lib"

async function importClasses() {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "board.kicad_pcb",
    await Bun.file(
      "tests/repros/repro07-kicad-project-design-rules/h616-ddr-data-corner.kicad_pcb",
    ).text(),
  )
  converter.addFile(
    "board.kicad_pro",
    JSON.stringify({
      net_settings: {
        meta: { version: 4 },
        classes: [
          { name: "Default", track_width: 0.2, priority: 2147483647 },
          { name: "Power", track_width: 0.8, priority: 1 },
          { name: "Sense", track_width: 0.8, priority: 2 },
          { name: "Inherited", priority: 0 },
          { name: "Unused", track_width: 0.4, priority: 3 },
        ],
        netclass_assignments: {
          "/DRAM/DQ2": ["Power"],
          "/DRAM/DQ5": ["Sense"],
          "/DRAM/DQ6": ["Inherited", "Power"],
        },
      },
    }),
  )
  converter.runUntilFinished()
  return converter.getOutput()
}

test("snapshot imported class identities alongside resolved widths", async () => {
  const circuitJson = await importClasses()
  const classes = circuitJson.filter(
    (element) => element.type === "source_net_class",
  )
  const rows = circuitJson
    .filter((element) => element.type === "source_net")
    .map((net, index) => {
      const names =
        net.source_net_class_ids
          ?.map(
            (id) =>
              classes.find((netClass) => netClass.source_net_class_id === id)
                ?.name,
          )
          .join(" + ") || "NO CLASS ASSIGNMENT"
      return `<text x="20" y="${85 + index * 30}">${net.name}: ${names} (${net.trace_width} mm)</text>`
    })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="340"><rect width="100%" height="100%" fill="#fff"/><g font-family="monospace" font-size="16" fill="#111"><text x="20" y="30">Imported KiCad net classes: Power and Sense both use 0.8 mm</text><text x="20" y="55">Class definitions retained: ${classes.length}</text>${rows.join("")}</g></svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path, "class-identity")
})

test.failing("import retains distinct same-width classes, unused classes and ordered assignments", async () => {
  const circuitJson = await importClasses()
  const classes = circuitJson.filter(
    (element) => element.type === "source_net_class",
  )
  expect(classes.map((netClass) => netClass.name).sort()).toEqual([
    "Default",
    "Inherited",
    "Power",
    "Sense",
    "Unused",
  ])
  const net = circuitJson.find(
    (element) => element.type === "source_net" && element.name === "DRAM_DQ6",
  )!
  expect(net.type).toBe("source_net")
  if (net.type !== "source_net") throw new Error("Missing net")
  expect(
    net.source_net_class_ids?.map(
      (id) =>
        classes.find((netClass) => netClass.source_net_class_id === id)?.name,
    ),
  ).toEqual(["Inherited", "Power", "Default"])
  expect(net.trace_width).toBe(0.8)
})
