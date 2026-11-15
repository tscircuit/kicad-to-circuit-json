const OPPOSITE_POLARITY: Record<string, string> = {
  "+": "-",
  "-": "+",
  P: "N",
  N: "P",
}

/**
 * Returns the name KiCad gives the other net of a differential pair, or
 * undefined for a net name without a polarity.
 *
 * Port of DRC_ENGINE::MatchDpSuffix, which is the same in KiCad 6 to 10:
 * trailing digits and underscores are skipped, the character before them is
 * the polarity (+, -, P or N) and the partner has the opposite polarity in
 * the same place. USB_D+ pairs with USB_D-, CLK_P1 with CLK_N1 and
 * /DRAM/SDQS0P with /DRAM/SDQS0N.
 */
export function getKicadDifferentialPairPartnerName(
  kicadNetName: string,
): string | undefined {
  let polarityIndex = kicadNetName.length - 1
  while (polarityIndex >= 0 && /[0-9_]/.test(kicadNetName[polarityIndex]!)) {
    polarityIndex--
  }
  const oppositePolarity = OPPOSITE_POLARITY[kicadNetName[polarityIndex] ?? ""]
  if (oppositePolarity === undefined) return undefined

  return (
    kicadNetName.slice(0, polarityIndex) +
    oppositePolarity +
    kicadNetName.slice(polarityIndex + 1)
  )
}

/**
 * Whether KiCad treats a net as one side of a differential pair, which is
 * what A.inDiffPair('*') tests in its design rules: the net name has a
 * polarity and the board has the net with the opposite polarity.
 */
export function isKicadDifferentialPairNet({
  kicadNetName,
  kicadNetNames,
}: {
  kicadNetName: string
  kicadNetNames: Set<string>
}): boolean {
  const partnerName = getKicadDifferentialPairPartnerName(kicadNetName)
  return partnerName !== undefined && kicadNetNames.has(partnerName)
}
