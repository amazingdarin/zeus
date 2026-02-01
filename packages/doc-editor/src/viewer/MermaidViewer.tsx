"use client"

import { useEffect, useRef, useState } from "react"
import mermaid from "mermaid"

export interface MermaidViewerProps {
  code: string
  theme?: "default" | "dark" | "forest" | "neutral"
}

// Counter to ensure unique IDs across all instances
let mermaidIdCounter = 0

export function MermaidViewer({ code, theme = "default" }: MermaidViewerProps) {
  const [svg, setSvg] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const idRef = useRef<number | null>(null)
  const isMountedRef = useRef(true)

  // Assign a stable ID on first render
  if (idRef.current === null) {
    idRef.current = ++mermaidIdCounter
  }

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    console.log(`[MermaidViewer] useEffect triggered, code length=${code.length}`);
    
    if (!code.trim()) {
      setSvg("")
      setError(null)
      return
    }

    let cancelled = false

    // Debounce rendering to avoid rapid updates causing issues
    const timeoutId = setTimeout(async () => {
      if (cancelled) {
        console.log(`[MermaidViewer] render cancelled before start`);
        return;
      }

      console.log(`[MermaidViewer] starting mermaid render...`);

      try {
        // Initialize mermaid with the specified theme
        mermaid.initialize({
          startOnLoad: false,
          theme,
          securityLevel: "loose",
          fontFamily: "inherit",
        })

        // Generate a unique ID for this render using our stable counter
        const elementId = `mermaid-${idRef.current}-${Date.now()}`
        
        console.log(`[MermaidViewer] calling mermaid.render with id=${elementId}`);
        // Render the diagram
        const { svg: renderedSvg } = await mermaid.render(elementId, code)
        console.log(`[MermaidViewer] mermaid.render done`);
        
        if (!cancelled && isMountedRef.current) {
          setSvg(renderedSvg)
          setError(null)
        }
      } catch (err) {
        console.log(`[MermaidViewer] mermaid.render error:`, err);
        if (!cancelled && isMountedRef.current) {
          const message = err instanceof Error ? err.message : "Failed to render Mermaid diagram"
          setError(message)
          setSvg("")
        }
      }
    }, 100) // 100ms debounce

    return () => {
      console.log(`[MermaidViewer] cleanup, cancelling render`);
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [code, theme])

  if (error) {
    return (
      <div className="mermaid-error">
        <div className="mermaid-error-title">Mermaid Error</div>
        <div className="mermaid-error-message">{error}</div>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="mermaid-placeholder">
        Enter Mermaid code to see the diagram
      </div>
    )
  }

  return (
    <div
      className="mermaid-viewer"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export default MermaidViewer
