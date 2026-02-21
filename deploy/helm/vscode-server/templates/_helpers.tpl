{{- define "vscode-server.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "vscode-server.fullname" -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- printf "%s" $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "vscode-server.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "vscode-server.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "vscode-server.authSecretName" -}}
{{- if .Values.auth.existingSecret -}}
{{- .Values.auth.existingSecret -}}
{{- else -}}
{{- include "vscode-server.fullname" . -}}
{{- end -}}
{{- end -}}
