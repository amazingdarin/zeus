package convert

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type Pandoc struct {
	binary string
}

func NewPandoc(binary string) *Pandoc {
	if strings.TrimSpace(binary) == "" {
		binary = "pandoc"
	}
	return &Pandoc{binary: binary}
}

func (p *Pandoc) Convert(ctx context.Context, input []byte, from string, to string) (string, error) {
	if len(input) == 0 {
		return "", errors.New("empty input")
	}
	workDir, err := os.MkdirTemp("", "zeus-pandoc-*")
	if err != nil {
		return "", fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(workDir)

	inputPath := filepath.Join(workDir, fmt.Sprintf("input.%s", from))
	outputPath := filepath.Join(workDir, fmt.Sprintf("output.%s", to))
	if err := os.WriteFile(inputPath, input, 0o600); err != nil {
		return "", fmt.Errorf("write input: %w", err)
	}

	args := []string{
		fmt.Sprintf("--from=%s", from),
		fmt.Sprintf("--to=%s", to),
		"--wrap=none",
		"-o", outputPath,
		inputPath,
	}
	cmd := exec.CommandContext(ctx, p.binary, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("pandoc failed: %s", message)
	}

	converted, err := os.ReadFile(outputPath)
	if err != nil {
		return "", fmt.Errorf("read output: %w", err)
	}
	return string(converted), nil
}
