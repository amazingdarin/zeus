package util

import (
	"fmt"
	"path/filepath"
	"strings"
	"unicode"
)

// SlugifyFilename returns a slug derived from the filename:
// 1) strip extension, 2) slugify, 3) trim dashes.
// Conflict resolution strategy (pseudo):
// if !exists(slug) return slug
//
//	for i := 2; ; i++ {
//	  candidate := fmt.Sprintf("%s-%d", slug, i)
//	  if !exists(candidate) return candidate
//	}
func SlugifyFilename(filename string) string {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		return ""
	}
	ext := filepath.Ext(filename)
	if ext != "" {
		filename = strings.TrimSuffix(filename, ext)
	}
	return Slugify(filename)
}

// Slugify converts a string to a lowercase slug, preserving unicode letters and digits.
func Slugify(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return ""
	}
	var out strings.Builder
	out.Grow(len(value))
	prevDash := false
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			out.WriteRune(r)
			prevDash = false
			continue
		}
		if r == '-' || r == '_' || unicode.IsSpace(r) {
			if prevDash || out.Len() == 0 {
				continue
			}
			out.WriteByte('-')
			prevDash = true
			continue
		}
		if prevDash || out.Len() == 0 {
			continue
		}
		out.WriteByte('-')
		prevDash = true
	}
	return strings.Trim(out.String(), "-")
}

// ResolveSlugConflict appends -2/-3/... until a unique slug is found.
func ResolveSlugConflict(base string, exists func(string) bool) string {
	base = strings.TrimSpace(base)
	if base == "" {
		return ""
	}
	if exists == nil || !exists(base) {
		return base
	}
	for i := 2; ; i++ {
		candidate := fmt.Sprintf("%s-%d", base, i)
		if !exists(candidate) {
			return candidate
		}
	}
}
