import { expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../../lib"

function convertNumberedNets(nets: Array<[number, string]>) {
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(
    "net-name-collisions.kicad_pcb",
    `(kicad_pcb (version 20240108) (generator pcbnew)
      (general (thickness 1.6))
      (paper "A4")
      (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
      (net 0 "")
      ${nets.map(([id, name]) => `(net ${id} "${name}")`).join("\n")}
      ${nets
        .map(
          ([id]) => `(segment (start 0 ${id}) (end 5 ${id})
            (width 0.25) (layer "F.Cu") (net ${id}))`,
        )
        .join("\n")}
    )`,
  )
  converter.runUntilFinished()
  return converter.getOutput()
}

test("numbered nets remain uniquely named when the net-number suffix is occupied", () => {
  const output = convertNumberedNets([
    [1, "VCC"],
    [2, "VCC_3"],
    [3, "/VCC"],
  ])
  const sourceNets = output.filter((element) => element.type === "source_net")
  expect(sourceNets.map((net) => net.name)).toEqual(["VCC", "VCC_3", "VCC_3_2"])

  const sourceTraces = output.filter(
    (element) => element.type === "source_trace",
  )
  expect(sourceTraces).toHaveLength(3)
  for (const net of sourceNets) {
    expect(
      sourceTraces.filter((trace) =>
        trace.connected_source_net_ids.includes(net.source_net_id),
      ),
    ).toHaveLength(1)
  }
})

test("numbered net names skip multiple occupied fallback suffixes", () => {
  const output = convertNumberedNets([
    [1, "VCC"],
    [2, "VCC_5"],
    [3, "VCC_5_2"],
    [4, "VCC_5_3"],
    [5, "/VCC"],
  ])
  expect(
    output
      .filter((element) => element.type === "source_net")
      .map((net) => net.name),
  ).toEqual(["VCC", "VCC_5", "VCC_5_2", "VCC_5_3", "VCC_5_4"])
})

test("numbered net names retain the existing suffix when it is available", () => {
  const output = convertNumberedNets([
    [1, "VCC"],
    [2, "/VCC"],
    [3, "GND"],
  ])
  expect(
    output
      .filter((element) => element.type === "source_net")
      .map((net) => net.name),
  ).toEqual(["VCC", "VCC_2", "GND"])
})
