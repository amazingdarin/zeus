package chatstream

import (
	"context"
	"fmt"
	"strings"
)

type SlashCommandType string

const (
	SlashCommandOperation SlashCommandType = "operation"
	SlashCommandPrompt    SlashCommandType = "prompt"
)

type SlashCommand struct {
	Name        string
	Type        SlashCommandType
	Template    string
	Description string
}

type SlashRequest struct {
	ProjectID  string
	ProjectKey string
	Input      string
}

type SlashResult struct {
	Command        string
	Mode           SlashCommandType
	Message        string
	ExpandedPrompt string
	Artifacts      []ChatArtifact
}

type SlashToolResult struct {
	Message   string
	Artifacts []ChatArtifact
}

type SlashToolInvoker interface {
	Invoke(ctx context.Context, projectKey, command, args string) (SlashToolResult, error)
}

type SlashRouter interface {
	Handle(ctx context.Context, req SlashRequest) (SlashResult, bool, error)
}

type DefaultSlashRouter struct {
	commands map[string]SlashCommand
	tool     SlashToolInvoker
}

func NewDefaultSlashRouter(commands []SlashCommand, tool SlashToolInvoker) *DefaultSlashRouter {
	index := make(map[string]SlashCommand, len(commands))
	for _, cmd := range commands {
		name := strings.TrimSpace(cmd.Name)
		if name == "" {
			continue
		}
		index[name] = cmd
	}
	return &DefaultSlashRouter{
		commands: index,
		tool:     tool,
	}
}

func (r *DefaultSlashRouter) Handle(ctx context.Context, req SlashRequest) (SlashResult, bool, error) {
	input := strings.TrimSpace(req.Input)
	if input == "" || !strings.HasPrefix(input, "/") {
		return SlashResult{}, false, nil
	}
	prefix, body := trimSlashPrefix(input)
	if prefix == "" {
		return SlashResult{}, false, nil
	}
	name, args := parseSlashBody(body)
	if name == "" {
		return SlashResult{}, false, nil
	}
	cmd, ok := r.commands[name]
	if !ok {
		return SlashResult{}, false, nil
	}
	if prefix == "op" && cmd.Type != SlashCommandOperation {
		return SlashResult{}, true, fmt.Errorf("command %s requires /p: prefix", name)
	}
	if prefix == "p" && cmd.Type != SlashCommandPrompt {
		return SlashResult{}, true, fmt.Errorf("command %s requires /op: prefix", name)
	}
	switch cmd.Type {
	case SlashCommandOperation:
		if r.tool == nil {
			return SlashResult{}, true, fmt.Errorf("slash command tool is not configured")
		}
		result, err := r.tool.Invoke(ctx, req.ProjectKey, cmd.Name, args)
		if err != nil {
			return SlashResult{}, true, err
		}
		return SlashResult{
			Command:   cmd.Name,
			Mode:      SlashCommandOperation,
			Message:   result.Message,
			Artifacts: result.Artifacts,
		}, true, nil
	case SlashCommandPrompt:
		expanded := strings.TrimSpace(cmd.Template)
		if expanded == "" {
			expanded = strings.TrimSpace(args)
		}
		if expanded != "" {
			expanded = strings.ReplaceAll(expanded, "{{input}}", strings.TrimSpace(args))
			expanded = strings.ReplaceAll(expanded, "{{args}}", strings.TrimSpace(args))
		}
		return SlashResult{
			Command:        cmd.Name,
			Mode:           SlashCommandPrompt,
			ExpandedPrompt: expanded,
		}, true, nil
	default:
		return SlashResult{}, true, fmt.Errorf("unsupported slash command type")
	}
}

func trimSlashPrefix(input string) (string, string) {
	trimmed := strings.TrimSpace(input)
	if !strings.HasPrefix(trimmed, "/") {
		return "", ""
	}
	if strings.HasPrefix(trimmed, "/in:") {
		return "", ""
	}
	if strings.HasPrefix(trimmed, "/op:") {
		return "op", strings.TrimPrefix(trimmed, "/op:")
	}
	if strings.HasPrefix(trimmed, "/p:") {
		return "p", strings.TrimPrefix(trimmed, "/p:")
	}
	return "", ""
}

func parseSlashBody(body string) (string, string) {
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		return "", ""
	}
	colonIndex := strings.Index(trimmed, ":")
	spaceIndex := strings.IndexFunc(trimmed, func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n'
	})
	if colonIndex >= 0 && (spaceIndex == -1 || colonIndex < spaceIndex) {
		name := strings.TrimSpace(trimmed[:colonIndex])
		if name == "" {
			return "", ""
		}
		args := strings.TrimSpace(trimmed[colonIndex+1:])
		return name, args
	}
	parts := strings.Fields(trimmed)
	if len(parts) == 0 {
		return "", ""
	}
	name := strings.TrimSpace(parts[0])
	if name == "" {
		return "", ""
	}
	args := strings.TrimSpace(strings.TrimPrefix(trimmed, parts[0]))
	return name, args
}
