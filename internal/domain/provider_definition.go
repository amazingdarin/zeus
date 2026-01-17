package domain

type ProviderAuthType string

type ProviderCapability string

type ProviderDefinition struct {
	ID                 string
	Name               string
	AuthType           ProviderAuthType
	DefaultBaseURL     string
	Capabilities       []ProviderCapability
	ChatEndpoint       string
	ResponsesEndpoint  string
	EmbeddingsEndpoint string
}

const (
	ProviderAuthAPI    ProviderAuthType = "api"
	ProviderAuthDevice ProviderAuthType = "device"
	ProviderAuthOAuth  ProviderAuthType = "oauth"
)

const (
	ProviderCapabilityChat       ProviderCapability = "chat"
	ProviderCapabilityResponses  ProviderCapability = "responses"
	ProviderCapabilityEmbeddings ProviderCapability = "embeddings"
)
