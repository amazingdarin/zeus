import { useEffect, useRef } from "react"

/**
 * Hook to scroll to a specific block by ID and highlight it
 * 
 * @param blockId - The block ID to scroll to (from URL parameter)
 * @param editorReady - Whether the editor content is ready
 */
export function useScrollToBlock(
  blockId: string | null,
  editorReady: boolean
): void {
  const hasScrolledRef = useRef(false)

  useEffect(() => {
    // Reset scroll flag when blockId changes
    hasScrolledRef.current = false
  }, [blockId])

  useEffect(() => {
    if (!blockId || !editorReady || hasScrolledRef.current) {
      return
    }

    // Delay execution to ensure DOM is fully rendered
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-block-id="${blockId}"]`)
      if (el) {
        // Scroll to the element
        el.scrollIntoView({ behavior: "smooth", block: "center" })
        
        // Add highlight animation class
        el.classList.add("block-highlight")
        
        // Remove highlight after animation completes
        const removeTimer = setTimeout(() => {
          el.classList.remove("block-highlight")
        }, 2000)

        hasScrolledRef.current = true

        return () => clearTimeout(removeTimer)
      }
    }, 150)

    return () => clearTimeout(timer)
  }, [blockId, editorReady])
}

export default useScrollToBlock
