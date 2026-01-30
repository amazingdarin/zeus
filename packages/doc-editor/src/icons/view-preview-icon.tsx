
import { memo } from "react"

type SvgProps = React.ComponentPropsWithoutRef<"svg">

export const ViewPreviewIcon = memo(({ className, ...props }: SvgProps) => {
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
        d="M12 6C7.02944 6 3.10936 8.98339 2 12C3.10936 15.0166 7.02944 18 12 18C16.9706 18 20.8906 15.0166 22 12C20.8906 8.98339 16.9706 6 12 6ZM12 16C8.68629 16 5.99474 14.3431 4.50028 12C5.99474 9.6569 8.68629 8 12 8C15.3137 8 18.0053 9.6569 19.4997 12C18.0053 14.3431 15.3137 16 12 16Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 10C10.8954 10 10 10.8954 10 12C10 13.1046 10.8954 14 12 14C13.1046 14 14 13.1046 14 12C14 10.8954 13.1046 10 12 10Z"
        fill="currentColor"
      />
    </svg>
  )
})

ViewPreviewIcon.displayName = "ViewPreviewIcon"
