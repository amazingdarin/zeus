package types

type CreateChatRunRequest struct {
	SessionID string `json:"session_id"`
	Message   string `json:"message"`
}

type CreateChatRunResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Data    struct {
		RunID string `json:"run_id"`
	} `json:"data"`
}
