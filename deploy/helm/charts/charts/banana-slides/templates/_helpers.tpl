{{- define "banana-slides.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "banana-slides.fullname" -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- printf "%s" $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "banana-slides.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "banana-slides.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "banana-slides.selectorLabels" -}}
app.kubernetes.io/name: {{ include "banana-slides.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "banana-slides.apiLabels" -}}
{{ include "banana-slides.selectorLabels" . }}
app.kubernetes.io/component: api
{{- end -}}

{{- define "banana-slides.workerLabels" -}}
{{ include "banana-slides.selectorLabels" . }}
app.kubernetes.io/component: worker
{{- end -}}
