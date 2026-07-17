import { expect } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"

const KICAD_PCBNEW_SCRIPT = `
import json
import sys
import pcbnew

board = pcbnew.LoadBoard(sys.argv[1])
board.BuildConnectivity()
connectivity = board.GetConnectivity()

groups = []

def node_key(pad):
    footprint = pad.GetParentFootprint()
    if footprint is None:
        return None
    reference = str(footprint.GetReference()).strip()
    if not reference:
        return None
    if pad.GetNetCode() <= 0:
        return None
    pad_number = str(pad.GetNumber())
    if not pad_number:
        return None
    return f"{reference}.{pad_number}"

for footprint in board.Footprints():
    for pad in footprint.Pads():
        nodes = set()
        seed_node = node_key(pad)
        if seed_node:
            nodes.add(seed_node)

        for item in connectivity.GetConnectedItems(pad, pcbnew.IGNORE_NETS):
            if item.Type() == pcbnew.PCB_PAD_T:
                connected_node = node_key(item)
                if connected_node:
                    nodes.add(connected_node)

        if nodes:
            groups.append(sorted(nodes))

print(json.dumps(groups))
`

export function hasKicadPcbnewPhysicalConnectivity() {
  return findKicadPcbnewPython() !== null
}

export function expectCircuitJsonConnectivityMatchesKicadPcbnewPhysical(params: {
  circuitJson: any[]
  kicadPcbPath: string
}) {
  const { circuitJson, kicadPcbPath } = params
  const expectedGroups = getKicadPcbnewPhysicalConnectivityGroups(kicadPcbPath)
  const actualGroups = getCircuitJsonPhysicalConnectivityGroups(circuitJson)
  const mismatchSummary = getConnectivityMismatchSummary({
    expectedGroups,
    actualGroups,
  })

  expect(mismatchSummary).toEqual({
    missingPhysicalGroupCount: 0,
    missingPhysicalGroups: [],
  })
}

function getCircuitJsonPhysicalConnectivityGroups(circuitJson: any[]) {
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
      `${refdes}.${String(port.pin_number)}`,
    )
  }

  const connectivityMap = getFullConnectivityMapFromCircuitJson(
    circuitJson as any,
  )
  const groups: string[][] = []

  for (const connectedIds of Object.values(connectivityMap.netMap)) {
    const nodeKeys = connectedIds
      .map((id) => nodeKeyBySourcePortId.get(id))
      .filter((nodeKey): nodeKey is string => Boolean(nodeKey))
    const group = [...new Set(nodeKeys)].sort(compareNodeKeys)
    if (group.length > 0) groups.push(group)
  }

  return groups
}

export function getKicadPcbnewPhysicalConnectivityGroups(kicadPcbPath: string) {
  const pythonPath = findKicadPcbnewPython()
  if (!pythonPath) {
    throw new Error(
      "KiCad pcbnew Python module is unavailable. Set KICAD_PCBNEW_PYTHON to KiCad's bundled python executable.",
    )
  }

  const stdout = execFileSync(
    pythonPath,
    ["-c", KICAD_PCBNEW_SCRIPT, kicadPcbPath],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 128 * 1024 * 1024,
    },
  )

  return normalizeConnectivityGroups(JSON.parse(stdout))
}

function findKicadPcbnewPython() {
  const candidates = getKicadPcbnewPythonCandidates()

  for (const candidate of candidates) {
    try {
      execFileSync(
        candidate,
        [
          "-c",
          "import pcbnew; assert hasattr(pcbnew, 'LoadBoard'); assert hasattr(pcbnew, 'IGNORE_NETS')",
        ],
        { stdio: "ignore" },
      )
      return candidate
    } catch {}
  }

  return null
}

function getKicadPcbnewPythonCandidates() {
  return [
    process.env.KICAD_PCBNEW_PYTHON,
    process.env.KICAD_PYTHON,
    "python3",
    "/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3",
    "/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/3.9/bin/python3",
  ].filter((candidate): candidate is string =>
    Boolean(
      candidate && (candidate.includes("/") ? existsSync(candidate) : true),
    ),
  )
}

function getConnectivityMismatchSummary(params: {
  expectedGroups: string[][]
  actualGroups: string[][]
}) {
  const { expectedGroups, actualGroups } = params
  const normalizedExpectedGroups = normalizeConnectivityGroups(expectedGroups)
  const normalizedActualGroups = normalizeConnectivityGroups(actualGroups)
  const missingPhysicalGroups = getMissingGroups(
    normalizedExpectedGroups,
    normalizedActualGroups,
  )

  return {
    missingPhysicalGroupCount: missingPhysicalGroups.length,
    missingPhysicalGroups: summarizeGroups(missingPhysicalGroups),
  }
}

function normalizeConnectivityGroups(groups: string[][]) {
  const groupsBySignature = new Map<string, string[]>()

  for (const group of groups) {
    const normalizedGroup = [...new Set(group)].sort(compareNodeKeys)
    // A singleton cannot assert physical connectivity. GenCAD still checks
    // logical one-pad nets, while this comparison focuses on copper-connected
    // groups of two or more pads.
    if (normalizedGroup.length < 2) continue

    groupsBySignature.set(getGroupSignature(normalizedGroup), normalizedGroup)
  }

  return [...groupsBySignature.values()].sort((a, b) =>
    getGroupSignature(a).localeCompare(getGroupSignature(b)),
  )
}

function getMissingGroups(
  expectedGroups: string[][],
  actualGroups: string[][],
) {
  const actualGroupSets = actualGroups.map((group) => new Set(group))

  // A logical KiCad net may contain multiple disconnected physical copper
  // islands. The conversion is correct when every physically connected group
  // is contained in one parsed logical group; requiring exact equality rejects
  // valid same-net components such as 0-ohm links and solder jumpers.
  return expectedGroups.filter((expectedGroup) =>
    actualGroupSets.every((actualGroup) =>
      expectedGroup.some((node) => !actualGroup.has(node)),
    ),
  )
}

function summarizeGroups(groups: string[][]) {
  return groups.slice(0, 20).map((group) => ({
    nodeCount: group.length,
    nodes: group.slice(0, 40),
  }))
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
