package handler

import (
	"bytes"
	"context"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"zeus/internal/domain"
)

type fakeConvertService struct {
	lastFrom string
	lastTo   string
}

func (f *fakeConvertService) Convert(_ context.Context, _ []byte, from string, to string) (string, error) {
	f.lastFrom = from
	f.lastTo = to
	return "converted", nil
}

type errorConvertService struct{}

func (e *errorConvertService) Convert(_ context.Context, _ []byte, _, _ string) (string, error) {
	return "", errors.New("convert failed")
}

type fakeProjectService struct {
	project *domain.Project
	err     error
}

func (f *fakeProjectService) Create(ctx context.Context, project *domain.Project) error {
	return errors.New("not implemented")
}

func (f *fakeProjectService) List(ctx context.Context) ([]*domain.Project, error) {
	return nil, errors.New("not implemented")
}

func (f *fakeProjectService) GetByKey(ctx context.Context, key string) (*domain.Project, error) {
	if f.err != nil {
		return nil, f.err
	}
	if f.project != nil {
		return f.project, nil
	}
	return &domain.Project{ID: "proj-id", Key: key}, nil
}

func TestConvertHandler_MissingProjectKey(t *testing.T) {
	handler := NewConvertHandler(&fakeConvertService{}, &fakeProjectService{})
	router := gin.New()
	router.POST("/api/projects/:project_key/convert", handler.Convert)

	req := httptest.NewRequest(http.MethodPost, "/api/projects//convert?from=docx&to=md", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestConvertHandler_MissingParams(t *testing.T) {
	handler := NewConvertHandler(&fakeConvertService{}, &fakeProjectService{})
	router := gin.New()
	router.POST("/api/projects/:project_key/convert", handler.Convert)

	req := httptest.NewRequest(http.MethodPost, "/api/projects/test/convert", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestConvertHandler_MissingFile(t *testing.T) {
	handler := NewConvertHandler(&fakeConvertService{}, &fakeProjectService{})
	router := gin.New()
	router.POST("/api/projects/:project_key/convert", handler.Convert)

	req := httptest.NewRequest(http.MethodPost, "/api/projects/test/convert?from=docx&to=md", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestConvertHandler_Success(t *testing.T) {
	converter := &fakeConvertService{}
	handler := NewConvertHandler(converter, &fakeProjectService{})
	router := gin.New()
	router.POST("/api/projects/:project_key/convert", handler.Convert)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "sample.docx")
	require.NoError(t, err)
	_, err = part.Write([]byte("docxdata"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/projects/test/convert?from=docx&to=md",
		body,
	)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "docx", converter.lastFrom)
	require.Equal(t, "md", converter.lastTo)
}

func TestConvertHandler_ProjectMissing(t *testing.T) {
	handler := NewConvertHandler(&fakeConvertService{}, &fakeProjectService{err: errors.New("missing")})
	router := gin.New()
	router.POST("/api/projects/:project_key/convert", handler.Convert)

	req := httptest.NewRequest(http.MethodPost, "/api/projects/test/convert?from=docx&to=md", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestConvertHandler_ConvertFailed(t *testing.T) {
	handler := NewConvertHandler(&errorConvertService{}, &fakeProjectService{})
	router := gin.New()
	router.POST("/api/projects/:project_key/convert", handler.Convert)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "sample.docx")
	require.NoError(t, err)
	_, err = part.Write([]byte("docxdata"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/projects/test/convert?from=docx&to=md",
		body,
	)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}
