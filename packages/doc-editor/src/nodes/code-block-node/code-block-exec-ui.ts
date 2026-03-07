export type CodeExecButtonStateInput = {
  editable: boolean
  running: boolean
}

export function resolveCodeExecButtonState(input: CodeExecButtonStateInput): {
  disabled: boolean
  label: string
} {
  if (!input.editable) {
    return {
      disabled: true,
      label: "运行",
    }
  }
  if (input.running) {
    return {
      disabled: true,
      label: "运行中...",
    }
  }
  return {
    disabled: false,
    label: "运行",
  }
}

export function mapCodeExecStatusLabel(status: string | undefined): string {
  switch (String(status ?? "").toLowerCase()) {
    case "completed":
      return "最近成功"
    case "failed":
      return "最近失败"
    case "timeout":
      return "最近超时"
    case "running":
      return "运行中"
    default:
      return ""
  }
}
