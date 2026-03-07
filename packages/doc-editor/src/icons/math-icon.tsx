import type { SVGProps } from "react"

export function MathIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* Sigma symbol for math */}
      <path d="M18 4H6l4 8-4 8h12" />
    </svg>
  )
}

export default MathIcon
