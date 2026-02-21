{{- define "faster-whisper.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "faster-whisper.fullname" -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- printf "%s" $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "faster-whisper.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "faster-whisper.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
