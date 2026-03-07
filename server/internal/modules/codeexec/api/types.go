package api

type ExecuteCodeRequest struct {
	RequestID  string `json:"requestId"`
	UserID     string `json:"userId"`
	OwnerType  string `json:"ownerType"`
	OwnerID    string `json:"ownerId"`
	ProjectKey string `json:"projectKey"`
	DocID      string `json:"docId"`
	BlockID    string `json:"blockId"`
	Language   string `json:"language"`
	Code       string `json:"code"`
	TimeoutMs  int    `json:"timeoutMs"`
}

type ListCodeRunsQuery struct {
	OwnerType  string `form:"ownerType"`
	OwnerID    string `form:"ownerId"`
	ProjectKey string `form:"projectKey"`
	DocID      string `form:"docId"`
	BlockID    string `form:"blockId"`
	Limit      int    `form:"limit"`
}
