package service

import (
	"testing"
)

func TestBuildJobSpec_EnforcesSecurityAndLimits(t *testing.T) {
	spec := BuildJobSpec(JobInput{
		RunID:          "run-1",
		Language:       "python",
		Code:           "print('ok')",
		TimeoutSeconds: 10,
		Images: RuntimeImages{
			Python: "python:3.12",
			Node:   "node:22",
			Bash:   "bash:5.2",
		},
	})
	if spec == nil {
		t.Fatalf("expected job spec, got nil")
	}
	if spec.Spec.Template.Spec.RestartPolicy != "Never" {
		t.Fatalf("expected restart policy Never, got %s", spec.Spec.Template.Spec.RestartPolicy)
	}
	if spec.Spec.ActiveDeadlineSeconds == nil || *spec.Spec.ActiveDeadlineSeconds != int64(10) {
		t.Fatalf("expected active deadline 10 seconds")
	}
	if spec.Spec.TTLSecondsAfterFinished == nil || *spec.Spec.TTLSecondsAfterFinished != int32(60) {
		t.Fatalf("expected ttl 60 seconds")
	}

	if len(spec.Spec.Template.Spec.Containers) != 1 {
		t.Fatalf("expected 1 container")
	}
	container := spec.Spec.Template.Spec.Containers[0]
	if container.Image != "python:3.12" {
		t.Fatalf("expected python image, got %s", container.Image)
	}
	if container.SecurityContext == nil {
		t.Fatalf("expected security context")
	}
	if container.SecurityContext.RunAsNonRoot == nil || !*container.SecurityContext.RunAsNonRoot {
		t.Fatalf("expected runAsNonRoot=true")
	}
	if container.SecurityContext.AllowPrivilegeEscalation == nil || *container.SecurityContext.AllowPrivilegeEscalation {
		t.Fatalf("expected allowPrivilegeEscalation=false")
	}
	if container.SecurityContext.ReadOnlyRootFilesystem == nil || !*container.SecurityContext.ReadOnlyRootFilesystem {
		t.Fatalf("expected readOnlyRootFilesystem=true")
	}
	if container.SecurityContext.SeccompProfile == nil || container.SecurityContext.SeccompProfile.Type != "RuntimeDefault" {
		t.Fatalf("expected seccomp runtime default")
	}
	if container.Resources.Limits.Cpu().String() != "500m" {
		t.Fatalf("expected cpu limit 500m, got %s", container.Resources.Limits.Cpu().String())
	}
	if container.Resources.Limits.Memory().String() != "256Mi" {
		t.Fatalf("expected memory limit 256Mi, got %s", container.Resources.Limits.Memory().String())
	}
	if container.Resources.Requests.Cpu().String() != "250m" {
		t.Fatalf("expected cpu request 250m, got %s", container.Resources.Requests.Cpu().String())
	}
	if container.Resources.Requests.Memory().String() != "128Mi" {
		t.Fatalf("expected memory request 128Mi, got %s", container.Resources.Requests.Memory().String())
	}

	if spec.Spec.Template.Spec.AutomountServiceAccountToken == nil || *spec.Spec.Template.Spec.AutomountServiceAccountToken {
		t.Fatalf("expected automountServiceAccountToken=false")
	}
	if len(spec.Spec.Template.Spec.Volumes) == 0 || spec.Spec.Template.Spec.Volumes[0].EmptyDir == nil {
		t.Fatalf("expected emptyDir volume")
	}
}

func TestBuildJobSpec_ResolvesRuntimeImageByLanguage(t *testing.T) {
	images := RuntimeImages{
		Python: "python:3.12",
		Node:   "node:22",
		Bash:   "bash:5.2",
	}
	python := BuildJobSpec(JobInput{RunID: "r1", Language: "python", Code: "print(1)", Images: images})
	js := BuildJobSpec(JobInput{RunID: "r2", Language: "javascript", Code: "console.log(1)", Images: images})
	bash := BuildJobSpec(JobInput{RunID: "r3", Language: "bash", Code: "echo 1", Images: images})

	if python.Spec.Template.Spec.Containers[0].Image != "python:3.12" {
		t.Fatalf("unexpected python image")
	}
	if js.Spec.Template.Spec.Containers[0].Image != "node:22" {
		t.Fatalf("unexpected node image")
	}
	if bash.Spec.Template.Spec.Containers[0].Image != "bash:5.2" {
		t.Fatalf("unexpected bash image")
	}
}
