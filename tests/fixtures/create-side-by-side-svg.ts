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

function toSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
}

export function createSideBySideSvg(
  sourceSvg: string,
  convertedSvg: string,
): string {
  const panelSize = readSvgSize(convertedSvg)
  const width = panelSize.width * 2

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${panelSize.height}" viewBox="0 0 ${width} ${panelSize.height}">
  <rect width="100%" height="100%" fill="#000"/>
  <image data-comparison="source" x="0" y="0" width="${panelSize.width}" height="${panelSize.height}" preserveAspectRatio="xMidYMid meet" href="${toSvgDataUrl(sourceSvg)}"/>
  <image data-comparison="converted" x="${panelSize.width}" y="0" width="${panelSize.width}" height="${panelSize.height}" preserveAspectRatio="xMidYMid meet" href="${toSvgDataUrl(convertedSvg)}"/>
</svg>`
}
