package logger

import (
	"zeus/internal/infra/session"

	"github.com/sirupsen/logrus"
)

type SessionHook struct{}

func (h *SessionHook) Levels() []logrus.Level {
	return logrus.AllLevels
}

func (h *SessionHook) Fire(e *logrus.Entry) error {
	if e.Context == nil {
		return nil
	}

	s, ok := session.FromContext(e.Context)
	if !ok {
		return nil
	}

	// 日志字段白名单（非常重要）
	e.Data["session_id"] = s.ID
	if s.UserID != "" {
		e.Data["user_id"] = s.UserID
	}

	return nil
}
