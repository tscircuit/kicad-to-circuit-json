import { expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { KicadToCircuitJsonConverter } from "../lib"

for (const [name, expectedNets] of [
  ["pic_programmer", 34],
  ["complex_hierarchy", 50],
] as const) {
  const folder = `kicad-demos/demos/${name}`
  const root = `${folder}/${name}.kicad_sch`
  test.skipIf(!existsSync(root) || !Bun.which("kicad-cli"))(
    `${name}: project connectivity matches native KiCad`,
    async () => {
      const converter = new KicadToCircuitJsonConverter()
      for (const file of readdirSync(folder).filter((file) =>
        file.endsWith(".kicad_sch"),
      )) {
        converter.addFile(
          `${folder}/${file}`,
          readFileSync(`${folder}/${file}`, "utf8"),
        )
      }
      converter.runUntilFinished()
      const output = converter.getOutput()
      const references = new Map(
        output.flatMap((element) =>
          element.type === "source_component"
            ? [[element.source_component_id, element.name] as const]
            : [],
        ),
      )
      const terminals = new Map(
        output.flatMap((element) => {
          if (element.type !== "source_port" || !element.source_component_id)
            return []
          const reference = references.get(element.source_component_id)
          // KiCad omits virtual power/flag symbols from its physical netlist.
          if (!reference || reference.startsWith("#")) return []
          return [
            [
              element.source_port_id,
              `${reference}.${element.pin_number ?? element.port_hints?.[0]}`,
            ] as const,
          ]
        }),
      )
      const converted = output.flatMap((element) =>
        element.type === "source_trace"
          ? [
              element.connected_source_port_ids.flatMap((id) =>
                terminals.has(id) ? [terminals.get(id)!] : [],
              ),
            ]
          : [],
      )
      const signatures = (nets: string[][]) =>
        nets
          .filter((net) => net.length > 1)
          .map((net) => [...new Set(net)].sort().join(","))
          .sort()
      const directory = await mkdtemp(
        join(tmpdir(), "schematic-project-netlist-"),
      )
      try {
        const path = join(directory, "native.xml")
        const process = Bun.spawn(
          [
            "kicad-cli",
            "sch",
            "export",
            "netlist",
            "--format",
            "kicadxml",
            "-o",
            path,
            root,
          ],
          { stdout: "ignore", stderr: "pipe" },
        )
        const stderr = await new Response(process.stderr).text()
        expect(await process.exited, stderr).toBe(0)
        const xml = await readFile(path, "utf8")
        const native = [...xml.matchAll(/<net\s[^>]*>([\s\S]*?)<\/net>/g)].map(
          (net) =>
            [
              ...net[1]!.matchAll(
                /<node\b[^>]*\bref="([^"]*)"[^>]*\bpin="([^"]*)"/g,
              ),
            ].map((node) => `${node[1]}.${node[2]}`),
        )
        expect(signatures(native)).toHaveLength(expectedNets)
        expect(signatures(converted)).toEqual(signatures(native))
        expect(converter.getWarnings()).toEqual([])
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
    20_000,
  )
}
