import { describe, expect, test } from "bun:test"
import { KicadToCircuitJsonConverter } from "../lib"

const library = `(symbol "Test:Node"
  (symbol "Node_1_1"
    (pin passive line (at 0 0 0) (length 2.54)
      (name "P" (effects (font (size 1 1))))
      (number "1" (effects (font (size 1 1)))))))`

function schematic(uuid: string, body = "", symbols = library) {
  return `(kicad_sch (version 20250114) (generator "eeschema")
    (uuid "${uuid}") (paper "A4") (lib_symbols ${symbols}) ${body})`
}

function sheet(uuid: string, file: string, pinX?: number) {
  return `(sheet (at 50 50) (size 20 20) (uuid "${uuid}")
    (property "Sheetname" "${uuid}" (at 50 49 0))
    (property "Sheetfile" "${file}" (at 50 71 0))
    ${pinX === undefined ? "" : `(pin "SIGNAL" input (at ${pinX} 50 0) (effects (font (size 1 1))))`})`
}

function symbol(
  uuid: string,
  reference: string,
  x = 20,
  y = 20,
  annotations = "",
) {
  return `(symbol (lib_id "Test:Node") (at ${x} ${y} 0) (unit 1) (uuid "${uuid}")
    (property "Reference" "${reference}" (at ${x} ${y + 2} 0))
    (property "Value" "Node" (at ${x} ${y + 4} 0)) ${annotations})`
}

function label(
  kind: "label" | "global_label" | "hierarchical_label",
  name: string,
  x = 20,
  y = 20,
) {
  return `(${kind} "${name}" ${kind === "label" ? "" : "(shape input)"}
    (at ${x} ${y} 0) (effects (font (size 1 1))))`
}

function wire(x1: number, y1: number, x2: number, y2: number) {
  return `(wire (pts (xy ${x1} ${y1}) (xy ${x2} ${y2})) (stroke (width 0) (type default)))`
}

function convert(files: Record<string, string>, root?: string) {
  const converter = new KicadToCircuitJsonConverter()
  for (const [path, content] of Object.entries(files))
    converter.addFile(path, content)
  if (root) converter.setRootSchematic(root)
  converter.runUntilFinished()
  return converter
}

describe("hierarchical schematic projects", () => {
  test("imports an 18-file project whose root has no symbols", () => {
    const files: Record<string, string> = {}
    files["project/root.kicad_sch"] = schematic(
      "root",
      Array.from({ length: 17 }, (_, index) =>
        sheet(`s${index}`, `children/${index}.kicad_sch`),
      ).join("\n"),
    )
    for (let index = 0; index < 17; index++) {
      files[`project/children/${index}.kicad_sch`] = schematic(
        `child${index}`,
        symbol(`r${index}`, `R${index + 1}`),
      )
    }
    const converter = convert(files)
    const output = converter.getOutput()
    const components = output.filter(
      (element) => element.type === "schematic_component",
    )
    expect(
      output.filter((element) => element.type === "source_component"),
    ).toHaveLength(17)
    expect(components).toHaveLength(17)
    expect(
      new Set(components.map((component) => component.center.x)).size,
    ).toBe(17)
    expect(converter.getStats().components).toBe(17)
    expect(converter.getRootSchematicPath()).toBe("project/root.kicad_sch")
    expect(converter.getWarnings()).toEqual([])
  })

  test("root-only imports fail with every missing child and its expected path", () => {
    expect(() =>
      convert({
        "project/root.kicad_sch": schematic(
          "root",
          sheet("a", "one.kicad_sch") + sheet("b", "sub/two.kicad_sch"),
        ),
      }),
    ).toThrow(
      /Incomplete schematic project[\s\S]*project\/one.kicad_sch[\s\S]*project\/sub\/two.kicad_sch/,
    )
  })

  test("resolves nested relative paths and Windows separators", () => {
    const converter = convert({
      "project\\root.kicad_sch": schematic(
        "root",
        sheet("a", "./sub/child.kicad_sch"),
      ),
      "project/sub/child.kicad_sch": schematic(
        "child",
        sheet("b", "../leaf.kicad_sch"),
      ),
      "project/leaf.kicad_sch": schematic("leaf", symbol("r", "R1")),
    })
    expect(
      converter
        .getOutput()
        .filter((element) => element.type === "source_component"),
    ).toHaveLength(1)
  })

  test("requires a root when multiple independent schematics are supplied", () => {
    const files = {
      "one.kicad_sch": schematic("one", symbol("r1", "R1")),
      "two.kicad_sch": schematic("two", symbol("r2", "R2")),
    }
    expect(() => convert(files)).toThrow(/setRootSchematic/)
    const converter = convert(files, "two.kicad_sch")
    expect(converter.getRootSchematicPath()).toBe("two.kicad_sch")
    expect(
      converter
        .getOutput()
        .filter((element) => element.type === "source_component"),
    ).toHaveLength(1)
  })

  test("detects cycles without treating repeated child instances as cycles", () => {
    expect(() =>
      convert(
        {
          "root.kicad_sch": schematic("root", sheet("a", "child.kicad_sch")),
          "child.kicad_sch": schematic("child", sheet("b", "root.kicad_sch")),
        },
        "root.kicad_sch",
      ),
    ).toThrow(
      /Cyclic schematic hierarchy: root.kicad_sch -> child.kicad_sch -> root.kicad_sch/,
    )
  })

  test("uses annotations for each placement and connects sheet pins without merging local labels", () => {
    const annotations = `(instances (project "root"
      (path "/root/a" (reference "R1") (unit 1))
      (path "/root/b" (reference "R2") (unit 1))))`
    const converter = convert({
      "root.kicad_sch": schematic(
        "root",
        symbol("r0", "R0", 10, 10) +
          sheet("a", "child.kicad_sch", 50) +
          sheet("b", "child.kicad_sch", 80) +
          wire(10, 10, 50, 50),
      ),
      "child.kicad_sch": schematic(
        "child",
        symbol("r", "R1", 20, 20, annotations) +
          label("label", "LOCAL") +
          label("hierarchical_label", "SIGNAL"),
      ),
    })
    const output = converter.getOutput()
    const components = output.filter(
      (element) => element.type === "source_component",
    )
    expect(components.map((component) => component.name)).toEqual([
      "R0",
      "R1",
      "R2",
    ])
    const ports = output.filter((element) => element.type === "source_port")
    const portFor = (name: string) =>
      ports.find(
        (element) =>
          element.source_component_id ===
          components.find((component) => component.name === name)
            ?.source_component_id,
      )
    const rootPort = portFor("R0")!
    const childPort = portFor("R1")!
    const otherPort = portFor("R2")!
    const traces = output.filter((element) => element.type === "source_trace")
    const connected = traces.find((trace) =>
      trace.connected_source_port_ids.includes(rootPort.source_port_id),
    )!
    expect(connected.connected_source_port_ids).toContain(
      childPort.source_port_id,
    )
    expect(connected.connected_source_port_ids).not.toContain(
      otherPort.source_port_id,
    )
    expect(traces).toHaveLength(2)
    expect(
      output.filter((element) => element.type === "source_net"),
    ).toHaveLength(2)
    expect(
      output
        .filter((element) => element.type === "schematic_text")
        .map((text) => text.text),
    ).toContain("R2")
    expect(converter.getWarnings()).toEqual([])
  })

  test("global labels join otherwise separate sheet instances", () => {
    const converter = convert({
      "root.kicad_sch": schematic(
        "root",
        sheet("a", "one.kicad_sch") + sheet("b", "two.kicad_sch"),
      ),
      "one.kicad_sch": schematic(
        "one",
        symbol("r1", "R1") + label("global_label", "VCC"),
      ),
      "two.kicad_sch": schematic(
        "two",
        symbol("r2", "R2") + label("global_label", "VCC"),
      ),
    })
    const output = converter.getOutput()
    const nets = output.filter((element) => element.type === "source_net")
    const traces = output.filter((element) => element.type === "source_trace")
    expect(nets.map((net) => net.name)).toEqual(["VCC"])
    expect(traces).toHaveLength(1)
    expect(traces[0]!.connected_source_port_ids).toHaveLength(2)
    expect(
      new Set(
        output
          .filter((element) => element.type === "schematic_net_label")
          .map((netLabel) => netLabel.source_net_id),
      ).size,
    ).toBe(1)
  })

  test.each([
    false,
    true,
  ])("crossing wires connect only with a junction (%s)", (junction) => {
    const converter = convert({
      "root.kicad_sch": schematic(
        "root",
        sheet("a", "child.kicad_sch") +
          symbol("r1", "R1", 0, 10) +
          symbol("r2", "R2", 20, 10) +
          symbol("r3", "R3", 10, 0) +
          symbol("r4", "R4", 10, 20) +
          wire(0, 10, 20, 10) +
          wire(10, 0, 10, 20) +
          (junction
            ? "(junction (at 10 10) (diameter 0) (color 0 0 0 0))"
            : ""),
      ),
      "child.kicad_sch": schematic("child"),
    })
    const traces = converter
      .getOutput()
      .filter((element) => element.type === "source_trace")
    expect(traces).toHaveLength(junction ? 1 : 2)
    expect(traces[0]!.connected_source_port_ids).toHaveLength(junction ? 4 : 2)
  })

  test("an intentionally empty single sheet still succeeds", () => {
    const converter = convert({ "empty.kicad_sch": schematic("empty") })
    expect(converter.getOutput()).toEqual([])
    expect(converter.getWarnings()).toEqual([])
  })

  test("instance unit annotations share one physical component without losing pins", () => {
    const twoUnits = library.replace(
      /\)$/,
      `(symbol "Node_2_1"
      (pin passive line (at 0 0 0) (length 2.54)
        (name "Q" (effects (font (size 1 1))))
        (number "2" (effects (font (size 1 1)))))))`,
    )
    const annotations = `(instances (project "root"
      (path "/root/a" (reference "U1") (unit 1))
      (path "/root/b" (reference "U1") (unit 2))))`
    const converter = convert({
      "root.kicad_sch": schematic(
        "root",
        sheet("a", "child.kicad_sch") + sheet("b", "child.kicad_sch"),
      ),
      "child.kicad_sch": schematic(
        "child",
        symbol("u", "U1", 20, 20, annotations),
        twoUnits,
      ),
    })
    const output = converter.getOutput()
    expect(
      output.filter((element) => element.type === "source_component"),
    ).toHaveLength(1)
    expect(
      output.filter((element) => element.type === "schematic_component"),
    ).toHaveLength(2)
    expect(
      output
        .filter((element) => element.type === "source_port")
        .map((port) => port.pin_number),
    ).toEqual([1, 2])
    expect(converter.getStats().components).toBe(1)
  })

  test("power flags do not join unrelated nets", () => {
    const flags = library
      .replace('(symbol "Test:Node"', '(symbol "Test:Node" (power)')
      .replace("pin passive", "pin power_out")
    const converter = convert({
      "root.kicad_sch": schematic(
        "root",
        sheet("a", "one.kicad_sch") + sheet("b", "two.kicad_sch"),
      ),
      "one.kicad_sch": schematic(
        "one",
        symbol("r1", "R1") + symbol("flag1", "#FLG1"),
        flags,
      ),
      "two.kicad_sch": schematic(
        "two",
        symbol("r2", "R2") + symbol("flag2", "#FLG2"),
        flags,
      ),
    })
    const traces = converter
      .getOutput()
      .filter((element) => element.type === "source_trace")
    expect(traces).toHaveLength(2)
    expect(
      traces.every((trace) => trace.connected_source_port_ids.length === 2),
    ).toBe(true)
  })

  test.each([
    "legacy",
    "global",
    "local",
  ])("handles %s power-symbol scope", (kind) => {
    const marker = kind === "legacy" ? "" : `(power ${kind})`
    const power = library
      .replace('(symbol "Test:Node"', `(symbol "Test:Node" ${marker}`)
      .replace("pin passive", "pin power_in")
      .replace('(name "P"', '(hide yes) (name "Node"')
    const converter = convert({
      "root.kicad_sch": schematic(
        "root",
        sheet("a", "one.kicad_sch") + sheet("b", "two.kicad_sch"),
      ),
      "one.kicad_sch": schematic("one", symbol("pwr1", "#PWR1"), power),
      "two.kicad_sch": schematic("two", symbol("pwr2", "#PWR2"), power),
    })
    const traces = converter
      .getOutput()
      .filter((element) => element.type === "source_trace")
    expect(traces).toHaveLength(kind === "local" ? 2 : 1)
    expect(traces[0]!.connected_source_port_ids).toHaveLength(
      kind === "local" ? 1 : 2,
    )
  })

  test("decodes escaped slash labels before resolving connections", () => {
    const converter = convert({
      "root.kicad_sch": schematic(
        "root",
        sheet("a", "child.kicad_sch") +
          symbol("r1", "R1") +
          label("label", "VPP{slash}MCLR"),
      ),
      "child.kicad_sch": schematic("child", symbol("r2", "R2")),
    })
    expect(
      converter
        .getOutput()
        .filter((element) => element.type === "source_net")
        .map((net) => net.name),
    ).toEqual(["/root/VPP/MCLR"])
  })

  test("adapts hierarchical labels without changing quoted text or comments", () => {
    const message = '(hierarchical_label "not a real label")'
    const converter = convert({
      "root.kicad_sch": schematic(
        "root",
        `
        ; (hierarchical_label "comment")
        (text ${JSON.stringify(message)} (at 30 30 0) (effects (font (size 1 1))))
        ${label("global_label", "GLOBAL", 10, 10)}
        ${label("hierarchical_label", "LOCAL", 20, 20)}`,
      ),
    })
    const output = converter.getOutput()
    expect(
      output
        .filter((element) => element.type === "source_net")
        .map((net) => net.name)
        .sort(),
    ).toEqual(["/root/LOCAL", "GLOBAL"])
    expect(
      output
        .filter((element) => element.type === "schematic_text")
        .map((text) => text.text),
    ).toContain(message)
  })

  test("keeps overline markup in electrical label identities", () => {
    const converter = convert({
      "root.kicad_sch": schematic(
        "root",
        sheet("a", "one.kicad_sch") + sheet("b", "two.kicad_sch"),
      ),
      "one.kicad_sch": schematic(
        "one",
        symbol("r1", "R1") + label("global_label", "~{RESET}"),
      ),
      "two.kicad_sch": schematic(
        "two",
        symbol("r2", "R2") + label("global_label", "RESET"),
      ),
    })
    const output = converter.getOutput()
    const nets = output.filter((element) => element.type === "source_net")
    expect(nets.map((net) => net.name).sort()).toEqual(["RESET", "~{RESET}"])
    expect(
      output.filter((element) => element.type === "source_trace"),
    ).toHaveLength(2)
    expect(
      output
        .filter((element) => element.type === "schematic_net_label")
        .every((label) =>
          nets.some((net) => net.source_net_id === label.source_net_id),
        ),
    ).toBe(true)
  })

  test("reports the child filename when its syntax is unsupported", () => {
    expect(() =>
      convert({
        "root.kicad_sch": schematic("root", sheet("a", "child.kicad_sch")),
        "child.kicad_sch": schematic("child", "(unsupported_feature)"),
      }),
    ).toThrow(/Could not parse schematic "child.kicad_sch"/)
  })
})
