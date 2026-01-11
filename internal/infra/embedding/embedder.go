package embedding

import "context"

type ModelRuntime struct {
	BaseURL   string
	APIKey    string
	ModelName string
}

type ModelRuntimeResolver interface {
	Resolve(ctx context.Context, scenario string) (ModelRuntime, error)
}

type Embedder interface {
	Embed(ctx context.Context, inputs []string) ([][]float32, error)
}
