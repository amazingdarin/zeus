import { memo } from "react"

type SvgProps = React.ComponentPropsWithoutRef<"svg">

export const FileIcon = memo(({ className, ...props }: SvgProps) => {
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
        d="M6 3C4.89543 3 4 3.89543 4 5V19C4 20.1046 4.89543 21 6 21H18C19.1046 21 20 20.1046 20 19V8.41421C20 7.88378 19.7893 7.37507 19.4142 7L15 2.58579C14.6249 2.21071 14.1162 2 13.5858 2H6ZM6 5H13V8C13 9.10457 13.8954 10 15 10H18V19H6V5Z"
        fill="currentColor"
      />
    </svg>
  )
})

FileIcon.displayName = "FileIcon"
