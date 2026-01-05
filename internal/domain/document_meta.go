package domain

import "time"

type DocumentMeta struct {
	ID        string    `json:"id"`
	Slug      string    `json:"slug"`
	Title     string    `json:"title"`
	Parent    string    `json:"parent"`
	Path      string    `json:"path"`
	Status    string    `json:"status"`
	DocType   string    `json:"doc_type"`
	Tags      []string  `json:"tags"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type DocumentContent struct {
	Meta    map[string]interface{} `json:"meta"`
	Content map[string]interface{} `json:"content"`
}
