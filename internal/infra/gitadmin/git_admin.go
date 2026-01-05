package gitadmin

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	log "github.com/sirupsen/logrus"
)

const DefaultBareRepoRoot = "/var/lib/zeus/git"

type GitAdmin interface {
	RepoURL(repoName string) string
	CreateBareRepo(ctx context.Context, repoName string) (string, error)
}

type ExecAdmin struct {
	repoRoot      string
	repoURLPrefix string
	logger        *log.Entry
}

func NewExecAdmin(repoRoot, repoURLPrefix string, logger *log.Entry) *ExecAdmin {
	repoRoot = strings.TrimSpace(repoRoot)
	if repoRoot == "" {
		repoRoot = DefaultBareRepoRoot
	}
	if logger == nil {
		logger = log.NewEntry(log.StandardLogger())
	}
	return &ExecAdmin{
		repoRoot:      repoRoot,
		repoURLPrefix: strings.TrimRight(strings.TrimSpace(repoURLPrefix), "/"),
		logger:        logger,
	}
}

func (a *ExecAdmin) RepoURL(repoName string) string {
	repoName = strings.TrimSpace(repoName)
	if repoName == "" {
		return ""
	}
	if a.repoURLPrefix != "" {
		return a.repoURLPrefix + "/" + repoName
	}
	return filepath.Join(a.repoRoot, repoName)
}

func (a *ExecAdmin) CreateBareRepo(ctx context.Context, repoName string) (string, error) {
	repoName = strings.TrimSpace(repoName)
	if repoName == "" {
		return "", fmt.Errorf("repo name is required")
	}
	repoPath := filepath.Join(a.repoRoot, repoName)
	if exists(repoPath) {
		return "", fmt.Errorf("repo already exists")
	}
	if err := os.MkdirAll(a.repoRoot, 0o755); err != nil {
		return "", fmt.Errorf("create repo root: %w", err)
	}
	if _, err := a.run(ctx, []string{"init", "--bare", repoPath}); err != nil {
		return "", fmt.Errorf("git init --bare: %w", err)
	}
	return a.RepoURL(repoName), nil
}

func (a *ExecAdmin) run(ctx context.Context, args []string) (string, error) {
	start := time.Now()
	cmd := exec.CommandContext(ctx, "git", args...)
	output, err := cmd.CombinedOutput()
	elapsed := time.Since(start)
	a.logCommand(args, elapsed, err)
	if err != nil {
		return string(output), fmt.Errorf("git %s failed: %w", strings.Join(args, " "), err)
	}
	return string(output), nil
}

func (a *ExecAdmin) logCommand(args []string, elapsed time.Duration, err error) {
	entry := a.logger.WithFields(log.Fields{
		"cmd":     "git " + strings.Join(args, " "),
		"elapsed": elapsed.String(),
		"success": err == nil,
	})
	if err != nil {
		entry.WithField("error", err.Error()).Warn("git command failed")
		return
	}
	entry.Info("git command completed")
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

var _ GitAdmin = (*ExecAdmin)(nil)
