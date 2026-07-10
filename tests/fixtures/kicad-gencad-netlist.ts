import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect } from "bun:test"
import { getSourcePortConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"

export function hasKicadCli() {
  try {
    execFileSync("kicad-cli", ["version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export function expectCircuitJsonConnectivityMatchesKicadGencad(params: {
  circuitJson: any[]
  kicadPcbPath: string
}) {
  const { circuitJson, kicadPcbPath } = params
  const expectedGroups = getKicadGencadNetlistGroups(kicadPcbPath)
  const actualGroups = getCircuitJsonSourceConnectivityGroups(circuitJson)

  const expectedSignatures = new Set(expectedGroups.map(getGroupSignature))
  const actualSignatures = new Set(actualGroups.map(getGroupSignature))
  const missingFromCircuitJson = expectedGroups.filter(
    (group) => !actualSignatures.has(getGroupSignature(group)),
  )
  const extraInCircuitJson = actualGroups.filter(
    (group) => !expectedSignatures.has(getGroupSignature(group)),
  )

  expect({
    missingFromCircuitJson,
    extraInCircuitJson,
  }).toEqual({
    missingFromCircuitJson: [],
    extraInCircuitJson: [],
  })
}

export function getKicadGencadNetlistGroups(kicadPcbPath: string) {
  const gencadText = exportKicadGencad(kicadPcbPath)
  const groups: string[][] = []
  let inSignals = false
  let currentNodes = new Set<string>()

  const flushSignal = () => {
    if (currentNodes.size > 0) {
      groups.push([...currentNodes].sort(compareNodeKeys))
    }
    currentNodes = new Set()
  }

  for (const line of gencadText.split(/\r?\n/)) {
    if (line === "$SIGNALS") {
      inSignals = true
      continue
    }

    if (line === "$ENDSIGNALS") {
      flushSignal()
      inSignals = false
      continue
    }

    if (!inSignals) continue

    if (line.startsWith("SIGNAL ")) {
      flushSignal()
      continue
    }

    if (line.startsWith("NODE ")) {
      const [refdes, padNumber] = getQuotedFields(line)
      if (refdes && padNumber) {
        currentNodes.add(getNodeKey(refdes, padNumber))
      }
    }
  }

  return groups
}

function exportKicadGencad(kicadPcbPath: string) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "kicad-gencad-"))
  const outputPath = path.join(
    tempDir,
    `${path.basename(kicadPcbPath, ".kicad_pcb")}.cad`,
  )

  execFileSync(
    "kicad-cli",
    ["pcb", "export", "gencad", "-o", outputPath, kicadPcbPath],
    { stdio: "pipe" },
  )

  if (!existsSync(outputPath)) {
    throw new Error(`KiCad did not write Gencad netlist to ${outputPath}`)
  }

  return readFileSync(outputPath, "utf-8")
}

function getCircuitJsonSourceConnectivityGroups(circuitJson: any[]) {
  const componentNameById = new Map<string, string>()
  for (const component of circuitJson) {
    if (component.type === "source_component") {
      componentNameById.set(component.source_component_id, component.name)
    }
  }

  const nodeKeyBySourcePortId = new Map<string, string>()
  for (const port of circuitJson) {
    if (port.type !== "source_port") continue

    const refdes = componentNameById.get(port.source_component_id)
    if (!refdes) continue

    nodeKeyBySourcePortId.set(
      port.source_port_id,
      getNodeKey(refdes, String(port.pin_number)),
    )
  }

  const connectivityMap = getSourcePortConnectivityMapFromCircuitJson(
    circuitJson as any,
  )
  const groups: string[][] = []
  const seenSignatures = new Set<string>()

  for (const connectedIds of Object.values(connectivityMap.netMap)) {
    const nodeKeys = connectedIds
      .map((id) => nodeKeyBySourcePortId.get(id))
      .filter((nodeKey): nodeKey is string => Boolean(nodeKey))
    const group = [...new Set(nodeKeys)].sort(compareNodeKeys)
    if (group.length === 0) continue

    const signature = getGroupSignature(group)
    if (seenSignatures.has(signature)) continue

    seenSignatures.add(signature)
    groups.push(group)
  }

  return groups.sort((a, b) =>
    getGroupSignature(a).localeCompare(getGroupSignature(b)),
  )
}

function getQuotedFields(line: string) {
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) =>
    match[1]!.replace(/\\"/g, '"'),
  )
}

function getNodeKey(refdes: string, padNumber: string) {
  return `${refdes}.${padNumber}`
}

function getGroupSignature(group: string[]) {
  return [...new Set(group)].sort(compareNodeKeys).join("\n")
}

function compareNodeKeys(a: string, b: string) {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  })
}
