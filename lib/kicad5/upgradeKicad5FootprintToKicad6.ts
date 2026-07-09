const KICAD5_MODULE_ROOT_RE = /^(\uFEFF?\s*)\(module(?=[\s"])/

/**
 * Best-effort upgrade path for legacy KiCad 5 standalone footprint files.
 *
 * Today we only normalize the KiCad 5 `(module ...)` root token into KiCad 6's
 * `(footprint ...)` root so modern parsers can continue from there. Additional
 * KiCad 5 compatibility rewrites should live here rather than inside `kicadts`.
 */
export function upgradeKicad5FootprintToKicad6(content: string) {
  return content.replace(KICAD5_MODULE_ROOT_RE, "$1(footprint")
}
