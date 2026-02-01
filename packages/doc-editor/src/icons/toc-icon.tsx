import { memo } from "react"

type SvgProps = React.ComponentPropsWithoutRef<"svg">

/**
 * Table of Contents icon - represents a list with indentation levels
 */
export const TocIcon = memo(({ className, ...props }: SvgProps) => {
  return (
    <svg
      width="24"
      height="24"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {/* Top level item */}
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="6" y1="6" x2="21" y2="6" />
      {/* Second level item 1 */}
      <line x1="6" y1="10" x2="6.01" y2="10" />
      <line x1="9" y1="10" x2="21" y2="10" />
      {/* Second level item 2 */}
      <line x1="6" y1="14" x2="6.01" y2="14" />
      <line x1="9" y1="14" x2="21" y2="14" />
      {/* Top level item 2 */}
      <line x1="3" y1="18" x2="3.01" y2="18" />
      <line x1="6" y1="18" x2="21" y2="18" />
    </svg>
  )
})

TocIcon.displayName = "TocIcon"
