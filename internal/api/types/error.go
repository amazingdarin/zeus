package types

// ErrorResponse 统一错误返回
type ErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
