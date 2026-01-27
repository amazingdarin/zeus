package knowledge

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/pmezard/go-difflib/difflib"
)

func diffJSON(base any, proposed any, fromName, toName string) (string, error) {
	basePayload, err := json.MarshalIndent(base, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal base json: %w", err)
	}
	proposedPayload, err := json.MarshalIndent(proposed, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal proposed json: %w", err)
	}
	if bytes.Equal(basePayload, proposedPayload) {
		return "", nil
	}
	diff := difflib.UnifiedDiff{
		A:        difflib.SplitLines(string(basePayload)),
		B:        difflib.SplitLines(string(proposedPayload)),
		FromFile: fromName,
		ToFile:   toName,
		Context:  3,
	}
	result, err := difflib.GetUnifiedDiffString(diff)
	if err != nil {
		return "", fmt.Errorf("diff json: %w", err)
	}
	return result, nil
}
