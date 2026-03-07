package api

import (
	"testing"
	"time"

	"zeus/internal/domain"
)

func TestToUserResponseIncludesLanguage(t *testing.T) {
	now := time.Now()
	user := &domain.User{
		ID: "user-1",
		Email: "test@example.com",
		Username: "tester",
		DisplayName: "Tester",
		Language: "en",
		Status: domain.UserStatusActive,
		CreatedAt: now,
	}

	response := toUserResponse(user)
	if response.Language != "en" {
		t.Fatalf("expected language en, got %q", response.Language)
	}
}
