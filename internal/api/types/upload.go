package types

// CreateUploadBatchRequest 创建一次上传任务
type CreateUploadBatchRequest struct {
	SourceType  string `json:"source_type" binding:"required"` // file | folder | url
	Description string `json:"description,omitempty"`
}

// CreateUploadBatchResponse 返回上传批次信息
type CreateUploadBatchResponse struct {
	BatchID   string `json:"batch_id"`
	UploadURL string `json:"upload_url"` // 后续文件上传地址
}

// UploadFileForm 文件上传表单字段（不包含 file 本身）
type UploadFileForm struct {
	RelativePath string `form:"relative_path"` // 文件夹内相对路径
}
