import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdirSync, writeFileSync } from "node:fs"
import { config, importText, validate } from "./harness"

const netModel = fc.record({
  assignments: fc.array(fc.integer({ min: 0, max: 3 }), {
    minLength: 2,
    maxLength: 20,
  }),
  bottom: fc.boolean(),
  code: fc.integer({ min: 10, max: 1000 }),
  reverse: fc.boolean(),
})
type Nets = typeof netModel extends fc.Arbitrary<infer T> ? T : never
function board(m: Nets, renamed = false) {
  const side = m.bottom ? "B" : "F"
  const code = (n: number) => (n === 0 ? 0 : renamed ? m.code + n : n)
  const name = (n: number) => (n === 0 ? "" : `SIGNAL_${n}`)
  const pads = m.assignments.map(
    (net, i) =>
      `(pad "${i + 1}" smd circle (at ${i * 3} 0) (size 1 1) (layers "${side}.Cu") (net ${code(net)} "${name(net)}"))`,
  )
  if (m.reverse) pads.reverse()
  return `(kicad_pcb (version 20240108) (generator pcbnew)
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
    ${[0, 1, 2, 3].map((n) => `(net ${code(n)} "${name(n)}")`).join("\n")}
    (footprint "Fuzz" (layer "${side}.Cu") (at 0 0)
      (uuid "${renamed ? "22222222-2222-4222-8222-222222222222" : "11111111-1111-4111-8111-111111111111"}")
      (property "Reference" "U1" (at 0 0 0) (layer "${side}.SilkS"))
      ${pads.join("\n")}))`
}
function membership(text: string) {
  const output = importText("pcb", text).elements
  validate(output)
  const ports = output.filter((e) => e.type === "source_port")
  const pinById = new Map(ports.map((p) => [p.source_port_id, p.pin_number]))
  const names = new Map(
    output
      .filter((e) => e.type === "source_net")
      .map((n) => [n.source_net_id, n.name]),
  )
  const groups: Record<string, number[]> = {}
  for (const trace of output.filter((e) => e.type === "source_trace")) {
    expect(trace.connected_source_net_ids).toHaveLength(1)
    const name = names.get(trace.connected_source_net_ids[0])!
    groups[name] = trace.connected_source_port_ids
      .map((id: string) => pinById.get(id))
      .sort((a: number, b: number) => a - b)
  }
  expect(ports).toHaveLength(output.filter((e) => e.type === "pcb_port").length)
  return groups
}
test("fuzz logical net partitions, unconnected pins, net renumbering and pad order", () => {
  const check = (m: Nets) => {
    const expected: Record<string, number[]> = {}
    m.assignments.forEach((net, i) => {
      if (net !== 0) (expected[`SIGNAL_${net}`] ??= []).push(i + 1)
    })
    expect(membership(board(m))).toEqual(expected)
    expect(membership(board({ ...m, reverse: !m.reverse }, true))).toEqual(
      expected,
    )
  }
  // Always exercise net 0; no random seed can accidentally miss unconnected pins.
  check({
    assignments: [0, 1, 1, 2, 3, 2],
    bottom: false,
    code: 20,
    reverse: false,
  })
  const r = fc.check(fc.property(netModel, check), config())
  if (r.failed) {
    mkdirSync("work/fuzz-failures/connectivity", { recursive: true })
    writeFileSync(
      "work/fuzz-failures/connectivity/input.kicad_pcb",
      board(r.counterexample![0]),
    )
    writeFileSync(
      "work/fuzz-failures/connectivity/failure.json",
      JSON.stringify(
        {
          seed: r.seed,
          path: r.counterexamplePath,
          model: r.counterexample,
          error: String(r.errorInstance),
        },
        null,
        2,
      ),
    )
    throw r.errorInstance
  }
})
