package types

type ProjectDTO struct {
	ID          string `json:"id"`
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	RepoURL     string `json:"repo_url"`
	RepoBaseURL string `json:"repo_base_url"`
	RepoName    string `json:"repo_name"`
	Status      string `json:"status"`
	CreatedAt   string `json:"created_at"`
	OwnerType   string `json:"owner_type"`
	OwnerKey    string `json:"owner_key"`
	OwnerID     string `json:"owner_id"`
	OwnerName   string `json:"owner_name"`
	CanWrite    bool   `json:"can_write"`
}

type ProjectOwnerContextDTO struct {
	OwnerType string `json:"owner_type"`
	OwnerKey  string `json:"owner_key"`
	OwnerID   string `json:"owner_id"`
	OwnerName string `json:"owner_name"`
	MyRole    string `json:"my_role"`
	CanCreate bool   `json:"can_create"`
}

type CreateProjectRequest struct {
	Key         string `json:"key" binding:"required"`
	Name        string `json:"name" binding:"required"`
	Description string `json:"description,omitempty"`
	OwnerType   string `json:"owner_type"`
	OwnerKey    string `json:"owner_key"`
}

type CreateProjectResponse struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Data    *ProjectDTO `json:"data,omitempty"`
}

type ListProjectRequest struct{}

type ListProjectResponseData struct {
	Contexts []*ProjectOwnerContextDTO `json:"contexts"`
	Projects []*ProjectDTO             `json:"projects"`
}

type ListProjectResponse struct {
	Code    string                   `json:"code"`
	Message string                   `json:"message"`
	Data    *ListProjectResponseData `json:"data"`
}

type ProjectDocumentDTO struct {
	ID              string `json:"id"`
	ProjectID       string `json:"project_id"`
	Type            string `json:"type"`
	Title           string `json:"title"`
	Description     string `json:"description,omitempty"`
	Status          string `json:"status"`
	Path            string `json:"path"`
	Order           int    `json:"order"`
	ParentID        string `json:"parent_id"`
	HasChild        bool   `json:"has_child"`
	StorageObjectID string `json:"storage_object_id"`
	CreatedAt       string `json:"created_at"`
	UpdatedAt       string `json:"updated_at"`
}

type ListProjectDocumentsRequest struct {
	ParentID string `form:"parent_id"`
}

type ListProjectDocumentsResponse struct {
	Code    string                `json:"code"`
	Message string                `json:"message"`
	Data    []*ProjectDocumentDTO `json:"data"`
}

type GetProjectDocumentResponse struct {
	Code    string              `json:"code"`
	Message string              `json:"message"`
	Data    *ProjectDocumentDTO `json:"data,omitempty"`
}
