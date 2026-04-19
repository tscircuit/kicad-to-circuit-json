import {
  startTransition,
  useEffect,
  useDeferredValue,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react"
import type { SimpleRouteJson } from "@tscircuit/core"
import { KicadToCircuitJsonConverter } from "@project-lib"

type CircuitJson = ReturnType<KicadToCircuitJsonConverter["getOutput"]>
type ConversionStats = NonNullable<
  ReturnType<KicadToCircuitJsonConverter["getStats"]>
>

const statLabels: Record<string, string> = {
  components: "Components",
  copper_pours: "Copper pours",
  labels: "Labels",
  pads: "Pads",
  traces: "Traces",
  vias: "Vias",
}
const runframeStandalonePreviewUrl =
  "https://unpkg.com/@tscircuit/runframe@0.0.1799/dist/standalone-preview.min.js"
const githubRepoUrl = "https://github.com/tscircuit/kicad-to-circuit-json"

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [circuitJson, setCircuitJson] = useState<CircuitJson | null>(null)
  const [simpleRouteJson, setSimpleRouteJson] =
    useState<SimpleRouteJson | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [isFrameLoading, setIsFrameLoading] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [stats, setStats] = useState<ConversionStats>({})
  const deferredCircuitJson = useDeferredValue(circuitJson)

  useEffect(() => {
    if (!deferredCircuitJson) {
      setFrameUrl(null)
      setIsFrameLoading(false)
      return
    }

    const html = createRunframeHtml({
      circuitJson: deferredCircuitJson,
      projectName: fileName?.replace(/\.kicad_pcb$/, "") ?? "board",
    })
    const nextFrameUrl = URL.createObjectURL(
      new Blob([html], { type: "text/html" }),
    )

    setFrameUrl(nextFrameUrl)
    setIsFrameLoading(true)

    return () => {
      URL.revokeObjectURL(nextFrameUrl)
    }
  }, [deferredCircuitJson, fileName])

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setIsDragging(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }
    setIsDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const [file] = Array.from(event.dataTransfer.files)
    if (file) {
      void convertFile(file)
    }
  }

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? [])
    if (file) {
      void convertFile(file)
    }
    event.target.value = ""
  }

  const convertFile = async (file: File) => {
    const nextFileName = file.name

    setIsConverting(true)
    setErrorMessage(null)
    setIsDragging(false)

    if (!nextFileName.endsWith(".kicad_pcb")) {
      startTransition(() => {
        setCircuitJson(null)
        setSimpleRouteJson(null)
        setErrorMessage("Drop a .kicad_pcb file.")
        setFileName(nextFileName)
        setFrameUrl(null)
        setWarnings([])
        setStats({})
      })
      setIsConverting(false)
      return
    }

    try {
      const fileContents = await file.text()

      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve())
      })

      const converter = new KicadToCircuitJsonConverter()
      converter.addFile(nextFileName, fileContents)
      converter.runUntilFinished()

      const nextCircuitJson = converter.getOutput()
      const nextWarnings = [...converter.getWarnings()]
      let nextSimpleRouteJson: SimpleRouteJson | null = null

      try {
        const { getSimpleRouteJsonFromCircuitJson } = await import(
          "@tscircuit/core"
        )
        nextSimpleRouteJson = getSimpleRouteJsonFromCircuitJson({
          circuitJson: stripRoutesForSimpleRouteExport(nextCircuitJson),
        }).simpleRouteJson
      } catch (error) {
        nextWarnings.push(
          `Simple Route JSON export unavailable: ${
            error instanceof Error ? error.message : "Unknown error."
          }`,
        )
      }

      startTransition(() => {
        setCircuitJson(nextCircuitJson)
        setSimpleRouteJson(nextSimpleRouteJson)
        setErrorMessage(null)
        setFileName(nextFileName)
        setWarnings(nextWarnings)
        setStats(converter.getStats())
      })
    } catch (error) {
      startTransition(() => {
        setCircuitJson(null)
        setSimpleRouteJson(null)
        setErrorMessage(
          error instanceof Error ? error.message : "Conversion failed.",
        )
        setFileName(nextFileName)
        setFrameUrl(null)
        setWarnings([])
        setStats({})
      })
    } finally {
      setIsConverting(false)
    }
  }

  const statsEntries = Object.entries(stats).filter(
    ([, value]) => typeof value === "number",
  )
  const outputBaseName = getOutputBaseName(fileName)

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-header">
          <div className="eyebrow">KiCad to Circuit JSON</div>
          <a
            className="repo-badge"
            href={githubRepoUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="View the kicad-to-circuit-json repository on GitHub"
          >
            <svg
              className="repo-badge-icon"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.57c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            <span>View repo</span>
          </a>
        </div>
        <h1>Convert KiCad to Circuit JSON in browser</h1>
        <p className="lede">
          This viewer reads a <code>.kicad_pcb</code> file, converts it with the
          local library source, and opens the result in the tscircuit runframe
          preview.
        </p>

        <div
          className={`dropzone${isDragging ? " dropzone-dragging" : ""}`}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept=".kicad_pcb"
            onChange={handleFileSelection}
          />
          <div className="dropzone-copy">
            <span className="dropzone-badge">Drag and drop</span>
            <strong>KiCad PCB files</strong>
            <p>or browse for a local board file</p>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose file
          </button>
        </div>

        <div className="meta-grid">
          <article className="meta-card">
            <span className="meta-label">Source</span>
            <strong>{fileName ?? "No file loaded"}</strong>
          </article>
          <article className="meta-card">
            <span className="meta-label">Elements</span>
            <strong>{circuitJson?.length ?? 0}</strong>
          </article>
          <article className="meta-card">
            <span className="meta-label">Warnings</span>
            <strong>{warnings.length}</strong>
          </article>
        </div>

        {circuitJson ? (
          <section className="panel">
            <div className="panel-header">
              <h2>Downloads</h2>
            </div>
            <div className="download-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  downloadJsonFile(
                    circuitJson,
                    `${outputBaseName}.circuit.json`,
                  )
                }
              >
                Download Circuit JSON
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={!simpleRouteJson}
                onClick={() => {
                  if (!simpleRouteJson) return
                  downloadJsonFile(
                    simpleRouteJson,
                    `${outputBaseName}.simple-route.json`,
                  )
                }}
              >
                Download Simple Route JSON
              </button>
            </div>
          </section>
        ) : null}

        {isConverting ? (
          <section className="notice-panel">
            <strong>Converting board…</strong>
            <p>Large KiCad files can take a moment in the main thread.</p>
          </section>
        ) : null}

        {errorMessage ? (
          <section className="notice-panel notice-panel-error">
            <strong>Conversion error</strong>
            <p>{errorMessage}</p>
          </section>
        ) : null}

        {statsEntries.length > 0 ? (
          <section className="panel">
            <div className="panel-header">
              <h2>Extracted elements</h2>
            </div>
            <div className="stats-list">
              {statsEntries.map(([key, value]) => (
                <div className="stat-chip" key={key}>
                  <span>{statLabels[key] ?? key}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {warnings.length > 0 ? (
          <section className="panel">
            <div className="panel-header">
              <h2>Warnings</h2>
            </div>
            <ul className="warning-list">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>

      <section className="viewer-panel">
        {frameUrl ? (
          <div className="viewer-frame-shell">
            {isFrameLoading ? (
              <div className="viewer-loading">Rendering runframe preview…</div>
            ) : null}
            <iframe
              className="viewer-iframe"
              title="Circuit JSON preview"
              src={frameUrl}
              sandbox="allow-downloads allow-same-origin allow-scripts"
              onLoad={() => setIsFrameLoading(false)}
            />
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-state-badge">Preview idle</span>
            <h2>The converted Circuit JSON will appear here.</h2>
            <p>
              Load a KiCad PCB file to open the PCB, CAD, and raw Circuit JSON
              tabs in the embedded viewer.
            </p>
          </div>
        )}
      </section>
    </main>
  )
}

function stripRoutesForSimpleRouteExport(
  circuitJson: CircuitJson,
): CircuitJson {
  return circuitJson.filter(
    (element) =>
      element?.type !== "pcb_trace" &&
      element?.type !== "pcb_copper_pour" &&
      element?.type !== "pcb_via",
  )
}

function createRunframeHtml({
  circuitJson,
  projectName,
}: {
  circuitJson: CircuitJson
  projectName: string
}) {
  const serializedCircuitJson = serializeForInlineScript(circuitJson)
  const serializedPreviewProps = serializeForInlineScript({
    availableTabs: ["pcb", "cad", "circuit_json"],
    autoRotate3dViewerDisabled: true,
    defaultActiveTab: "pcb",
    isWebEmbedded: true,
    projectName,
    showCodeTab: false,
    showFileMenu: false,
    showJsonTab: true,
    showRightHeaderContent: false,
    showToggleFullScreen: true,
  })

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      html, body, #root {
        height: 100%;
        margin: 0;
      }

      body {
        background: #f8fafb;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
      window.CIRCUIT_JSON = ${serializedCircuitJson};
      window.CIRCUIT_JSON_PREVIEW_PROPS = ${serializedPreviewProps};
    </script>
    <script src="${runframeStandalonePreviewUrl}"></script>
  </body>
</html>`
}

function serializeForInlineScript(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
}

function getOutputBaseName(fileName: string | null) {
  if (!fileName) return "board"
  return fileName.replace(/\.kicad_pcb$/i, "")
}

function downloadJsonFile(data: unknown, fileName: string) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")

  link.href = url
  link.download = fileName
  link.click()

  URL.revokeObjectURL(url)
}
