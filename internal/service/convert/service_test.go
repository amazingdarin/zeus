package convert

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

type fakeConverter struct {
	called int
}

func (f *fakeConverter) Convert(_ context.Context, _ []byte, _, _ string) (string, error) {
	f.called += 1
	return "ok", nil
}

type errorConverter struct{}

func (e *errorConverter) Convert(_ context.Context, _ []byte, _, _ string) (string, error) {
	return "", errors.New("convert failed")
}

func TestService_Convert_Valid(t *testing.T) {
	converter := &fakeConverter{}
	svc := NewService(converter)

	out, err := svc.Convert(context.Background(), []byte("data"), "docx", "md")
	require.NoError(t, err)
	require.Equal(t, "ok", out)
	require.Equal(t, 1, converter.called)
}

func TestService_Convert_Unsupported(t *testing.T) {
	converter := &fakeConverter{}
	svc := NewService(converter)

	_, err := svc.Convert(context.Background(), []byte("data"), "pdf", "md")
	require.Error(t, err)
	require.Equal(t, 0, converter.called)
}

func TestService_Convert_MissingParams(t *testing.T) {
	converter := &fakeConverter{}
	svc := NewService(converter)

	_, err := svc.Convert(context.Background(), []byte("data"), "", "md")
	require.Error(t, err)
	require.Equal(t, 0, converter.called)
}

func TestService_Convert_TooLarge(t *testing.T) {
	converter := &fakeConverter{}
	svc := NewService(converter)

	payload := make([]byte, maxFileSizeBytes+1)
	_, err := svc.Convert(context.Background(), payload, "docx", "md")
	require.Error(t, err)
	require.Equal(t, 0, converter.called)
}

func TestService_Convert_Error(t *testing.T) {
	svc := NewService(&errorConverter{})

	_, err := svc.Convert(context.Background(), []byte("data"), "docx", "md")
	require.Error(t, err)
}
