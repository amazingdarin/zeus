import { memo } from "react"

type SvgProps = React.ComponentPropsWithoutRef<"svg">

export const OpenApiIcon = memo(({ className, ...props }: SvgProps) => {
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
        d="M4 4C2.89543 4 2 4.89543 2 6V18C2 19.1046 2.89543 20 4 20H20C21.1046 20 22 19.1046 22 18V6C22 4.89543 21.1046 4 20 4H4ZM4 6H20V18H4V6Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6 8C5.44772 8 5 8.44772 5 9V15C5 15.5523 5.44772 16 6 16H8C8.55228 16 9 15.5523 9 15V9C9 8.44772 8.55228 8 8 8H6ZM7 10V14H7V10H7Z"
        fill="currentColor"
      />
      <path
        d="M11 10C11 9.44772 11.4477 9 12 9H18C18.5523 9 19 9.44772 19 10C19 10.5523 18.5523 11 18 11H12C11.4477 11 11 10.5523 11 10Z"
        fill="currentColor"
      />
      <path
        d="M11 13C11 12.4477 11.4477 12 12 12H18C18.5523 12 19 12.4477 19 13C19 13.5523 18.5523 14 18 14H12C11.4477 14 11 13.5523 11 13Z"
        fill="currentColor"
      />
      <path
        d="M11 16C11 15.4477 11.4477 15 12 12H18C18.5523 12 19 12.4477 19 13V16H11Z"
        fill="currentColor"
      />
    </svg>
  )
})

OpenApiIcon.displayName = "OpenApiIcon"
