package types

type ProjectDTO struct {
	ID          string `json:"id"`
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Status      string `json:"status"`
	CreatedAt   string `json:"created_at"`
}

type CreateProjectRequest struct {
	Key         string `json:"key" binding:"required"`
	Name        string `json:"name" binding:"required"`
	Description string `json:"description,omitempty"`
}

type CreateProjectResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`

	Data struct {
		ID        string `json:"id"`
		CreatedAt string `json:"created_at"`
	} `json:"data"`
}

type ListProjectRequest struct{}

type ListProjectResponse struct {
	Code    string        `json:"code"`
	Message string        `json:"message"`
	Data    []*ProjectDTO `json:"data"`
}
