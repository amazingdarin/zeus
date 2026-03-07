package service

import (
	"strings"
	"testing"
)

func TestNormalizeOutput_TruncateAndTimeout(t *testing.T) {
	stdout := strings.Repeat("a", 300*1024)
	out := normalizeOutput(stdout, "", 137, 256*1024, true, 10023)

	if !out.Truncated {
		t.Fatalf("expected truncated=true")
	}
	if !out.TimedOut {
		t.Fatalf("expected timedOut=true")
	}
	if len([]byte(out.Stdout)) != 256*1024 {
		t.Fatalf("expected stdout bytes 262144, got %d", len([]byte(out.Stdout)))
	}
}

func TestNormalizeOutput_TruncateKeepsUTF8Boundary(t *testing.T) {
	input := "你好世界"
	// "你" is 3 bytes in UTF-8, limit 4 should still produce valid UTF-8 output.
	out := normalizeOutput(input, "", 0, 4, false, 10)
	if !out.Truncated {
		t.Fatalf("expected truncated=true")
	}
	if out.Stdout != "你" {
		t.Fatalf("expected utf8-safe truncation to '你', got %q", out.Stdout)
	}
}
