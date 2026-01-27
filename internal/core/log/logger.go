package logger

import (
	"path/filepath"

	log "github.com/sirupsen/logrus"
)

type ErrorCallerFormatter struct {
	Base log.Formatter
}

func (f *ErrorCallerFormatter) Format(entry *log.Entry) ([]byte, error) {
	base := f.Base
	if base == nil {
		base = &log.TextFormatter{}
	}
	if entry.Level <= log.ErrorLevel && entry.Caller != nil {
		newEntry := *entry
		data := log.Fields{}
		for k, v := range entry.Data {
			data[k] = v
		}
		data["caller_file"] = filepath.Base(entry.Caller.File)
		data["caller_line"] = entry.Caller.Line
		newEntry.Data = data
		return base.Format(&newEntry)
	}
	return base.Format(entry)
}
