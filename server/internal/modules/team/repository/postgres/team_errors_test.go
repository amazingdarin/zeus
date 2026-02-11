package postgres

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

func TestIsUniqueViolation(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil", err: nil, want: false},
		{name: "gorm duplicated key", err: gorm.ErrDuplicatedKey, want: true},
		{name: "wrapped gorm duplicated key", err: fmt.Errorf("wrapped: %w", gorm.ErrDuplicatedKey), want: true},
		{name: "pg unique violation", err: &pgconn.PgError{Code: "23505"}, want: true},
		{name: "wrapped pg unique violation", err: fmt.Errorf("wrapped: %w", &pgconn.PgError{Code: "23505"}), want: true},
		{name: "other pg error", err: &pgconn.PgError{Code: "23503"}, want: false},
		{name: "sqlstate string fallback", err: errors.New("ERROR: duplicate key value violates unique constraint \"team_member_team_id_user_id_key\" (SQLSTATE 23505)"), want: true},
		{name: "duplicate message fallback", err: errors.New("duplicate key value violates unique constraint"), want: true},
		{name: "plain error", err: errors.New("boom"), want: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := isUniqueViolation(tc.err); got != tc.want {
				t.Fatalf("isUniqueViolation() = %v, want %v", got, tc.want)
			}
		})
	}
}
