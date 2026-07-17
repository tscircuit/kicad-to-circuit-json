import { expect } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { getCircuitJsonSourceConnectivityGroups } from "./kicad-gencad-netlist"

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
    pad_number = str(pad.GetNumber())
    if not pad_number:
        return None
    return f"{footprint.GetReference()}.{pad_number}"

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
  const actualGroups = getCircuitJsonSourceConnectivityGroups(circuitJson)
  const mismatchSummary = getConnectivityMismatchSummary({
    expectedGroups,
    actualGroups,
  })

  expect(mismatchSummary).toEqual({
    missingPhysicalGroupCount: 0,
    missingPhysicalGroups: [],
    extraGeneratedGroupCount: 0,
    extraGeneratedGroups: [],
  })
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
  const extraGeneratedGroups = getMissingGroups(
    normalizedActualGroups,
    normalizedExpectedGroups,
  )

  return {
    missingPhysicalGroupCount: missingPhysicalGroups.length,
    missingPhysicalGroups: summarizeGroups(missingPhysicalGroups),
    extraGeneratedGroupCount: extraGeneratedGroups.length,
    extraGeneratedGroups: summarizeGroups(extraGeneratedGroups),
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
  const actualSignatures = new Set(actualGroups.map(getGroupSignature))
  return expectedGroups.filter(
    (group) => !actualSignatures.has(getGroupSignature(group)),
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
