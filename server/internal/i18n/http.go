package i18n

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const DefaultLocale = "zh-CN"

var messages = map[string]map[string]string{
	"zh-CN": {
		"error.unauthorized":          "未登录或登录已失效",
		"error.invalid_request":       "请求参数不合法",
		"error.internal_error":        "发生了未预期的错误",
		"error.invalid_credentials":   "邮箱或密码错误",
		"error.email_exists":          "邮箱已注册",
		"error.username_exists":       "用户名已被占用",
		"error.user_not_active":       "用户账号未启用",
		"error.invalid_token":         "令牌无效或已过期",
		"error.user_not_found":        "用户不存在",
		"error.invalid_password":      "当前密码不正确",
		"error.team_not_found":        "团队不存在",
		"error.slug_exists":           "团队标识已存在",
		"error.not_member":            "不是该团队成员",
		"error.not_authorized":        "没有权限执行此操作",
		"error.member_exists":         "该用户已经是团队成员",
		"error.cannot_remove_owner":   "不能移除团队所有者",
		"error.invitation_not_found":  "邀请不存在",
		"error.invitation_expired":    "邀请已过期",
		"error.invite_link_not_found": "邀请链接不存在",
		"error.invite_link_expired":   "邀请链接已过期",
		"error.missing_username":      "缺少用户名",
		"error.missing_token":         "缺少令牌",
		"success.password_changed":    "密码修改成功",
		"success.team_deleted":        "团队已删除",
		"success.member_added":        "成员已添加",
		"success.role_updated":        "角色已更新",
		"success.member_removed":      "成员已移除",
		"success.invitation_accepted": "邀请已接受",
		"error.internal_token_missing": "内部令牌未配置",
		"error.invalid_internal_token": "内部令牌无效",
		"error.handler_not_ready": "代码运行处理器未初始化",
		"error.invalid_scope": "缺少 owner/project/doc/block 范围",
		"error.run_id_required": "缺少运行 ID",
		"error.run_not_found": "运行记录不存在",
	},
	"en": {
		"error.unauthorized":          "Not authenticated",
		"error.invalid_request":       "Invalid request",
		"error.internal_error":        "An unexpected error occurred",
		"error.invalid_credentials":   "Invalid email or password",
		"error.email_exists":          "Email already registered",
		"error.username_exists":       "Username already taken",
		"error.user_not_active":       "User account is not active",
		"error.invalid_token":         "Invalid or expired token",
		"error.user_not_found":        "User not found",
		"error.invalid_password":      "Current password is incorrect",
		"error.team_not_found":        "Team not found",
		"error.slug_exists":           "Team slug already exists",
		"error.not_member":            "Not a member of this team",
		"error.not_authorized":        "Not authorized",
		"error.member_exists":         "User is already a member",
		"error.cannot_remove_owner":   "Cannot remove team owner",
		"error.invitation_not_found":  "Invitation not found",
		"error.invitation_expired":    "Invitation has expired",
		"error.invite_link_not_found": "Invite link not found",
		"error.invite_link_expired":   "Invite link has expired",
		"error.missing_username":      "Missing username",
		"error.missing_token":         "Missing token",
		"success.password_changed":    "Password changed successfully",
		"success.team_deleted":        "Team deleted",
		"success.member_added":        "Member added",
		"success.role_updated":        "Role updated",
		"success.member_removed":      "Member removed",
		"success.invitation_accepted": "Invitation accepted",
		"error.internal_token_missing": "Internal token is not configured",
		"error.invalid_internal_token": "Invalid internal token",
		"error.handler_not_ready": "Code-runner handler is not initialized",
		"error.invalid_scope": "Owner/project/doc/block scope is required",
		"error.run_id_required": "Run ID is required",
		"error.run_not_found": "Run not found",
	},
}

func NormalizeLocale(raw string) string {
	value := strings.TrimSpace(strings.ToLower(raw))
	if value == "" {
		return DefaultLocale
	}
	if strings.HasPrefix(value, "en") {
		return "en"
	}
	if strings.HasPrefix(value, "zh") {
		return "zh-CN"
	}
	return DefaultLocale
}

func ResolveLocale(r *http.Request) string {
	if r == nil {
		return DefaultLocale
	}
	explicit := strings.TrimSpace(r.Header.Get("X-Zeus-Locale"))
	if explicit != "" {
		return NormalizeLocale(explicit)
	}
	accept := strings.TrimSpace(r.Header.Get("Accept-Language"))
	if accept == "" {
		return DefaultLocale
	}
	parts := strings.Split(accept, ",")
	for _, part := range parts {
		candidate := strings.TrimSpace(strings.Split(part, ";")[0])
		if candidate == "" {
			continue
		}
		return NormalizeLocale(candidate)
	}
	return DefaultLocale
}

func Message(locale, key string) string {
	normalized := NormalizeLocale(locale)
	if table, ok := messages[normalized]; ok {
		if msg, ok := table[key]; ok {
			return msg
		}
	}
	if table, ok := messages[DefaultLocale]; ok {
		if msg, ok := table[key]; ok {
			return msg
		}
	}
	return key
}

func MessageForRequest(r *http.Request, key string) (string, string) {
	locale := ResolveLocale(r)
	return Message(locale, key), locale
}

func JSONError(c *gin.Context, status int, code, key string) {
	message, locale := MessageForRequest(c.Request, key)
	c.JSON(status, gin.H{
		"code":    code,
		"message": message,
		"locale":  locale,
	})
}

func JSONMessage(c *gin.Context, status int, key string) {
	message, locale := MessageForRequest(c.Request, key)
	c.JSON(status, gin.H{
		"message": message,
		"locale":  locale,
	})
}
