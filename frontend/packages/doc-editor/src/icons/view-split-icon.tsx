
import { memo } from "react"

type SvgProps = React.ComponentPropsWithoutRef<"svg">

export const ViewSplitIcon = memo(({ className, ...props }: SvgProps) => {
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
        d="M4 5C2.89543 5 2 5.89543 2 7V17C2 18.1046 2.89543 19 4 19H20C21.1046 19 22 18.1046 22 17V7C22 5.89543 21.1046 5 20 5H4ZM4 7H11V17H4V7ZM13 7H20V17H13V7Z"
        fill="currentColor"
      />
    </svg>
  )
})

ViewSplitIcon.displayName = "ViewSplitIcon"
