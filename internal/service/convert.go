package service

import "context"

type ConvertService interface {
	Convert(ctx context.Context, input []byte, from string, to string) (string, error)
}
