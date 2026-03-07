package service

import (
	"fmt"
	"strings"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/utils/ptr"
)

const (
	defaultJobTTLSeconds = int32(60)
	defaultTimeoutSecond = int64(10)
	defaultWorkDir       = "/tmp/work"
)

type RuntimeImages struct {
	Python string
	Node   string
	Bash   string
}

type JobInput struct {
	RunID          string
	Language       string
	Code           string
	TimeoutSeconds int
	Images         RuntimeImages
}

func defaultRuntimeImages() RuntimeImages {
	return RuntimeImages{
		Python: "ghcr.io/zeus/code-runner-python:latest",
		Node:   "ghcr.io/zeus/code-runner-node:latest",
		Bash:   "ghcr.io/zeus/code-runner-bash:latest",
	}
}

func BuildJobSpec(input JobInput) *batchv1.Job {
	timeout := int64(input.TimeoutSeconds)
	if timeout <= 0 {
		timeout = defaultTimeoutSecond
	}
	name := strings.TrimSpace(input.RunID)
	if name == "" {
		name = "run-unknown"
	}
	images := input.Images
	if strings.TrimSpace(images.Python) == "" || strings.TrimSpace(images.Node) == "" || strings.TrimSpace(images.Bash) == "" {
		images = defaultRuntimeImages()
	}

	return &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name: fmt.Sprintf("code-run-%s", name),
		},
		Spec: batchv1.JobSpec{
			TTLSecondsAfterFinished: ptr.To(defaultJobTTLSeconds),
			ActiveDeadlineSeconds:   ptr.To(timeout),
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					RestartPolicy:                corev1.RestartPolicyNever,
					AutomountServiceAccountToken: ptr.To(false),
					Containers: []corev1.Container{
						{
							Name:            "runner",
							Image:           resolveRuntimeImage(input.Language, images),
							ImagePullPolicy: corev1.PullIfNotPresent,
							Command:         buildRunCommand(input.Language, input.Code),
							WorkingDir:      defaultWorkDir,
							Resources: corev1.ResourceRequirements{
								Requests: corev1.ResourceList{
									corev1.ResourceCPU:    resource.MustParse("250m"),
									corev1.ResourceMemory: resource.MustParse("128Mi"),
								},
								Limits: corev1.ResourceList{
									corev1.ResourceCPU:    resource.MustParse("500m"),
									corev1.ResourceMemory: resource.MustParse("256Mi"),
								},
							},
							SecurityContext: &corev1.SecurityContext{
								RunAsNonRoot:             ptr.To(true),
								Privileged:               ptr.To(false),
								AllowPrivilegeEscalation: ptr.To(false),
								ReadOnlyRootFilesystem:   ptr.To(true),
								Capabilities: &corev1.Capabilities{
									Drop: []corev1.Capability{"ALL"},
								},
								SeccompProfile: &corev1.SeccompProfile{
									Type: corev1.SeccompProfileTypeRuntimeDefault,
								},
							},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:      "workdir",
									MountPath: defaultWorkDir,
								},
							},
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "workdir",
							VolumeSource: corev1.VolumeSource{
								EmptyDir: &corev1.EmptyDirVolumeSource{
									SizeLimit: ptr.To(resource.MustParse("32Mi")),
								},
							},
						},
					},
				},
			},
		},
	}
}

func resolveRuntimeImage(language string, images RuntimeImages) string {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case "python":
		return images.Python
	case "javascript", "typescript", "node":
		return images.Node
	case "bash", "sh", "shell":
		return images.Bash
	default:
		return images.Bash
	}
}

func buildRunCommand(language string, code string) []string {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case "python":
		return []string{"python", "-c", code}
	case "javascript", "typescript", "node":
		return []string{"node", "-e", code}
	default:
		return []string{"bash", "-lc", code}
	}
}
