import type { Evidence } from "./evidence"
const esc = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
export function renderEvidence(e: Evidence): string {
  const color = e.passing ? "#087f5b" : "#c92a2a"
  const status = e.passing ? "PASS" : "DEFECT"
  const text = (
    x: number,
    y: number,
    value: unknown,
    size = 20,
    fill = "#253247",
  ) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}">${esc(value)}</text>`
  const box = (
    x: number,
    y: number,
    w: number,
    h: number,
    fill = "#f1f5f9",
    stroke = "#d8e0e9",
  ) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${fill}" stroke="${stroke}"/>`
  let body = ""
  if (e.kind === "pad") {
    const v = e.values as {
      width: number
      height: number
      expectedRadius: number
      actualRadius: number
    }
    for (const [x, radius, stroke] of [
      [70, v.expectedRadius, "#087f5b"],
      [550, v.actualRadius, color],
    ] as const) {
      body += `<rect x="${x}" y="190" width="${v.width * 90}" height="${v.height * 90}" rx="${radius * 90}" fill="#cb6338" stroke="${stroke}" stroke-width="4"/>`
      body += `<path d="M ${x} 475 h ${v.width * 90}" stroke="#64748b" stroke-width="1"/>`
      body += text(x + 130, 500, "4.00 mm", 18)
    }
  } else if (e.kind === "reference") {
    body += box(65, 210, 345, 180)
    body += text(90, 245, "PCB port", 24)
    body += text(90, 287, e.values.pcbPortId, 18)
    body += text(90, 325, "source_port_id", 17, "#64748b")
    body += text(90, 355, e.values.sourcePortId, 17)
    body += `<path d="M 418 300 H 567" stroke="${color}" stroke-width="4" ${e.passing ? "" : 'stroke-dasharray="9 7"'}/><path d="M 552 289 l 17 11 -17 11" fill="none" stroke="${color}" stroke-width="4"/>`
    body += box(585, 210, 350, 180, e.passing ? "#e6fcf5" : "#fff5f5", color)
    body += text(610, 245, "Source port", 24)
    body += text(610, 287, e.values.sourcePortId, 17)
    body += text(610, 343, e.passing ? "PRESENT" : "MISSING", 26, color)
    body += text(
      80,
      457,
      "An unconnected terminal is still an element; no net is invented.",
      20,
    )
  } else if (e.kind === "ids") {
    body += box(60, 190, 420, 265)
    body += text(85, 240, "Every text record has:", 23)
    body += text(85, 295, "1. A nonempty primary ID", 20)
    body += text(85, 340, "2. An ID distinct from other records", 20)
    body += box(520, 190, 420, 265, e.passing ? "#e6fcf5" : "#fff5f5", color)
    const ids = e.values.ids as string[]
    ids.forEach((id, i) => {
      body += text(
        545,
        240 + i * 100,
        `Fabrication note ${i === 0 ? "A" : "B"}`,
        22,
      )
      body += text(545, 277 + i * 100, id || '""  (empty string)', 17, color)
    })
  } else {
    body += box(60, 190, 420, 265)
    body += text(85, 255, 'anchor: "center"', 26)
    body += text(85, 327, "VALID ENUM VALUE", 23, "#087f5b")
    body += box(520, 190, 420, 265, e.passing ? "#e6fcf5" : "#fff5f5", color)
    body += text(545, 255, e.actual, 23)
    body += text(
      545,
      327,
      e.passing ? "SCHEMA ACCEPTS" : "SCHEMA REJECTS",
      23,
      color,
    )
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="560" viewBox="0 0 1000 560"><rect width="1000" height="560" fill="#ffffff"/><g font-family="DejaVu Sans, Arial, sans-serif"><rect width="1000" height="98" fill="#f1f5f9"/>${text(35, 43, e.title, 25)}${text(35, 77, e.description, 17)}<rect x="834" y="20" width="136" height="45" rx="22" fill="${color}"/>${text(863, 50, status, 21, "white")}${text(60, 133, "EXPECTED", 15, "#64748b")}${text(60, 166, e.expected, 22)}${text(520, 133, "IMPORTED OUTPUT", 15, "#64748b")}${text(520, 166, e.actual, 22, color)}${body}${text(35, 541, e.detail, 16, "#64748b")}</g></svg>\n`
}
