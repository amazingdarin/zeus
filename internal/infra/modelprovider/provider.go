package modelprovider

import "context"

type ModelInfo struct {
	ID   string
	Name string
}

type ModelProvider interface {
	ListModels(ctx context.Context) ([]ModelInfo, error)
}
