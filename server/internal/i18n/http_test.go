package i18n

import (
	"net/http/httptest"
	"testing"
)

func TestResolveLocalePrefersExplicitHeader(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Zeus-Locale", "en-US")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	if got := ResolveLocale(req); got != "en" {
		t.Fatalf("expected en, got %q", got)
	}
}

func TestResolveLocaleFallsBackToAcceptLanguage(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	if got := ResolveLocale(req); got != "zh-CN" {
		t.Fatalf("expected zh-CN, got %q", got)
	}
}

func TestMessageFallsBackToDefaultLocale(t *testing.T) {
	if got := Message("fr-FR", "error.unauthorized"); got != "未登录或登录已失效" {
		t.Fatalf("unexpected fallback message: %q", got)
	}
}
