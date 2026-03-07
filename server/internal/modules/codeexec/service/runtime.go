package service

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"strings"
	"time"
)

type RuntimeExecuteInput struct {
	Language       string
	Code           string
	TimeoutSeconds int
	MaxOutputBytes int
}

type RuntimeExecutor interface {
	Execute(ctx context.Context, input RuntimeExecuteInput) (ExecuteResult, error)
}

type LocalRuntimeExecutor struct{}

func NewLocalRuntimeExecutor() *LocalRuntimeExecutor {
	return &LocalRuntimeExecutor{}
}

func (e *LocalRuntimeExecutor) Execute(ctx context.Context, input RuntimeExecuteInput) (ExecuteResult, error) {
	timeout := time.Duration(input.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	command := buildRunCommand(input.Language, input.Code)
	if len(command) == 0 {
		return normalizeOutput("", "unsupported language", 2, input.MaxOutputBytes, false, 0), nil
	}

	cmd := exec.CommandContext(runCtx, command[0], command[1:]...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	startedAt := time.Now()
	err := cmd.Run()
	durationMs := time.Since(startedAt).Milliseconds()

	timedOut := errors.Is(runCtx.Err(), context.DeadlineExceeded)
	exitCode := 0
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else if timedOut {
			exitCode = 124
		} else {
			exitCode = 1
		}
	}
	return normalizeOutput(
		strings.TrimSpace(stdout.String()),
		strings.TrimSpace(stderr.String()),
		exitCode,
		input.MaxOutputBytes,
		timedOut,
		durationMs,
	), nil
}
