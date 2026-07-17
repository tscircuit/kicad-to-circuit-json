import type { FootprintPad } from "kicadts"

function isPlatedThroughHolePad(pad: FootprintPad): boolean {
  return pad.padType === "thru_hole"
}

function isCustomPlatedThroughHolePad(pad: FootprintPad): boolean {
  return isPlatedThroughHolePad(pad) && pad.shape === "custom"
}

function getPadBoundingRadius(pad: FootprintPad): number {
  const width = pad.size?.width ?? 0
  const height = pad.size?.height ?? 0
  return Math.hypot(width / 2, height / 2)
}

function padBoundingCirclesOverlap(
  firstPad: FootprintPad,
  secondPad: FootprintPad,
): boolean {
  const centerDistance = Math.hypot(
    (firstPad.at?.x ?? 0) - (secondPad.at?.x ?? 0),
    (firstPad.at?.y ?? 0) - (secondPad.at?.y ?? 0),
  )

  return (
    centerDistance <=
    getPadBoundingRadius(firstPad) + getPadBoundingRadius(secondPad)
  )
}

function findConnectedPadIndexGroups(
  pads: readonly FootprintPad[],
  candidateIndexes: readonly number[],
): number[][] {
  const unvisitedIndexes = new Set(candidateIndexes)
  const connectedGroups: number[][] = []

  while (unvisitedIndexes.size > 0) {
    const firstIndex = unvisitedIndexes.values().next().value
    if (firstIndex === undefined) break

    const connectedIndexes: number[] = []
    const pendingIndexes = [firstIndex]
    unvisitedIndexes.delete(firstIndex)

    while (pendingIndexes.length > 0) {
      const currentIndex = pendingIndexes.shift()!
      connectedIndexes.push(currentIndex)

      for (const candidateIndex of unvisitedIndexes) {
        if (
          padBoundingCirclesOverlap(pads[currentIndex]!, pads[candidateIndex]!)
        ) {
          unvisitedIndexes.delete(candidateIndex)
          pendingIndexes.push(candidateIndex)
        }
      }
    }

    connectedGroups.push(connectedIndexes)
  }

  return connectedGroups
}

/**
 * A KiCad footprint may describe one physical plated feature with overlapping
 * pads that share a pad number. Circuit JSON preserves those elements
 * separately, so custom copper must precede the ordinary plated holes whose
 * drills remain visible above it.
 */
export function orderOverlappingFootprintPads(
  pads: readonly FootprintPad[],
): FootprintPad[] {
  const orderedPads = [...pads]
  const platedPadIndexesByNumber = new Map<string, number[]>()

  for (const [index, pad] of pads.entries()) {
    if (!pad.number || !isPlatedThroughHolePad(pad)) continue

    const padIndexes = platedPadIndexesByNumber.get(pad.number) ?? []
    padIndexes.push(index)
    platedPadIndexesByNumber.set(pad.number, padIndexes)
  }

  for (const padIndexes of platedPadIndexesByNumber.values()) {
    const connectedGroups = findConnectedPadIndexGroups(pads, padIndexes)

    for (const connectedIndexes of connectedGroups) {
      const padsInOriginalOrder = connectedIndexes.map((index) => pads[index]!)
      const customPads = padsInOriginalOrder.filter(
        isCustomPlatedThroughHolePad,
      )
      const ordinaryPads = padsInOriginalOrder.filter(
        (pad) => !isCustomPlatedThroughHolePad(pad),
      )

      if (customPads.length === 0 || ordinaryPads.length === 0) continue

      const padsInConversionOrder = [...customPads, ...ordinaryPads]
      for (const [groupIndex, originalIndex] of connectedIndexes.entries()) {
        orderedPads[originalIndex] = padsInConversionOrder[groupIndex]!
      }
    }
  }

  return orderedPads
}
