package service

import (
	"unicode/utf8"
)

func normalizeOutput(
	stdout string,
	stderr string,
	exitCode int,
	maxOutputBytes int,
	timedOut bool,
	durationMs int64,
) ExecuteResult {
	limit := maxOutputBytes
	if limit <= 0 {
		limit = DefaultMaxOutputBytes
	}

	remaining := limit
	truncated := false

	stdoutTrimmed, stdoutTruncated := truncateUTF8ByBytes(stdout, remaining)
	if stdoutTruncated {
		truncated = true
	}
	remaining -= len([]byte(stdoutTrimmed))
	if remaining < 0 {
		remaining = 0
	}

	stderrTrimmed, stderrTruncated := truncateUTF8ByBytes(stderr, remaining)
	if stderrTruncated {
		truncated = true
	}

	return ExecuteResult{
		Stdout:     stdoutTrimmed,
		Stderr:     stderrTrimmed,
		ExitCode:   exitCode,
		DurationMs: durationMs,
		Truncated:  truncated,
		TimedOut:   timedOut,
	}
}

func truncateUTF8ByBytes(input string, maxBytes int) (string, bool) {
	if maxBytes < 0 {
		maxBytes = 0
	}
	raw := []byte(input)
	if len(raw) <= maxBytes {
		return input, false
	}
	if maxBytes == 0 {
		return "", len(raw) > 0
	}
	cut := maxBytes
	for cut > 0 && !utf8.Valid(raw[:cut]) {
		cut--
	}
	if cut < 0 {
		cut = 0
	}
	return string(raw[:cut]), true
}
