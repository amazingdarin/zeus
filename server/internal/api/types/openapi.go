package types

type OpenAPIIndexResponse struct {
	Code    string          `json:"code"`
	Message string          `json:"message"`
	Data    OpenAPIIndexDTO `json:"data"`
}

type OpenAPIIndexDTO struct {
	Title     string               `json:"title"`
	Version   string               `json:"version"`
	Tags      []OpenAPITagDTO      `json:"tags"`
	Endpoints []OpenAPIEndpointDTO `json:"endpoints"`
}

type OpenAPITagDTO struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type OpenAPIEndpointDTO struct {
	Path        string   `json:"path"`
	Method      string   `json:"method"`
	Summary     string   `json:"summary"`
	Tags        []string `json:"tags"`
	OperationID string   `json:"operationId"`
}
