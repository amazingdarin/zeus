package service

type ExecuteResult struct {
	Stdout     string
	Stderr     string
	ExitCode   int
	DurationMs int64
	Truncated  bool
	TimedOut   bool
}

type ExecuteLimits struct {
	MaxOutputBytes int
}

const DefaultMaxOutputBytes = 256 * 1024
