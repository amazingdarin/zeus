
import { memo } from "react"

type SvgProps = React.ComponentPropsWithoutRef<"svg">

export const ViewTextIcon = memo(({ className, ...props }: SvgProps) => {
  return (
    <svg
      width="24"
      height="24"
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 6C4 5.44772 4.44772 5 5 5H20C20.5523 5 21 5.44772 21 6C21 6.55228 20.5523 7 20 7H5C4.44772 7 4 6.55228 4 6Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 12C4 11.4477 4.44772 11 5 11H20C20.5523 11 21 11.4477 21 12C21 12.5523 20.5523 13 20 13H5C4.44772 13 4 12.5523 4 12Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 18C4 17.4477 4.44772 17 5 17H20C20.5523 17 21 17.4477 21 18C21 18.5523 20.5523 19 20 19H5C4.44772 19 4 18.5523 4 18Z"
        fill="currentColor"
      />
    </svg>
  )
})

ViewTextIcon.displayName = "ViewTextIcon"
