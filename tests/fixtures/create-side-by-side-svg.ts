type SvgSize = {
  height: number
  width: number
}

function readSvgSize(svg: string): SvgSize {
  const rootTag = svg.match(/<svg\b[^>]*>/u)?.[0]
  if (!rootTag) throw new Error("Expected an SVG root element")

  const width = Number(rootTag.match(/\bwidth=["']([\d.]+)["']/u)?.[1])
  const height = Number(rootTag.match(/\bheight=["']([\d.]+)["']/u)?.[1])
  if (!(width > 0) || !(height > 0)) {
    throw new Error("Expected positive numeric SVG width and height")
  }

  return { height, width }
}

function createPanel(
  svg: string,
  comparison: "source" | "converted",
  x: number,
  size: SvgSize,
): string {
  const rootTag = svg.match(/<svg\b[^>]*>/u)?.[0]
  if (!rootTag) throw new Error("Expected an SVG root element")
  const viewBox = rootTag.match(/\bviewBox=["']([^"']+)["']/u)?.[1]
  const originalSize = viewBox ? undefined : readSvgSize(svg)
  const content = svg.slice(
    svg.indexOf(rootTag) + rootTag.length,
    svg.lastIndexOf("</svg>"),
  )
  // Large base64 image attributes can exceed libxml's input lookup limit.
  // Keep the vector geometry inline and preserve the original viewport/styles.
  const attributes = rootTag
    .slice(4, -1)
    .replace(/\s(?:x|y|width|height|preserveAspectRatio)=["'][^"']*["']/gu, "")
  const fallbackViewBox = viewBox
    ? ""
    : ` viewBox="0 0 ${originalSize!.width} ${originalSize!.height}"`
  return `<svg${attributes}${fallbackViewBox} data-comparison="${comparison}" x="${x}" y="0" width="${size.width}" height="${size.height}" preserveAspectRatio="xMidYMid meet">${content}</svg>`
}

export function createSideBySideSvg(
  sourceSvg: string,
  convertedSvg: string,
): string {
  const panelSize = readSvgSize(convertedSvg)
  const width = panelSize.width * 2

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${panelSize.height}" viewBox="0 0 ${width} ${panelSize.height}">
  <rect width="100%" height="100%" fill="#000"/>
  ${createPanel(sourceSvg, "source", 0, panelSize)}
  ${createPanel(convertedSvg, "converted", panelSize.width, panelSize)}
</svg>`
}
