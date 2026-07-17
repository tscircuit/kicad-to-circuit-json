/**
 * Removes optional KiCad metadata that current kicadts releases reject. The
 * converter does not model these identity, mask, or zone-attachment fields;
 * stripping them preserves the geometry and net assignments it does model.
 */
export function normalizeKicadPcbForParser(pcbText: string) {
  let cursor = 0
  let output = ""

  while (cursor < pcbText.length) {
    const start = pcbText.indexOf("(gr_poly", cursor)
    if (start === -1) {
      output += pcbText.slice(cursor)
      break
    }

    output += pcbText.slice(cursor, start)
    const end = findSExpressionEnd(pcbText, start)
    const polygon = pcbText.slice(start, end)
    output += polygon.replace(/\s+\(tstamp\s+[^()\s]+\)/g, "")
    cursor = end
  }

  return output
    .replace(/(\(group(?:\s+"(?:[^"\\]|\\.)*")?)\s+\(id\s+[^()\s]+\)/g, "$1")
    .replace(/\s+\(zone_layer_connections(?:\s+"[^"]+")*\)/g, "")
    .replace(/\s+\(tenting\s+[^()]+\)/g, "")
}

function findSExpressionEnd(text: string, start: number) {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const character = text[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === "(") {
      depth += 1
    } else if (character === ")") {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }

  return text.length
}
