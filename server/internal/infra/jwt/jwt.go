package jwt

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("token has expired")
)

// TokenType distinguishes access tokens from refresh tokens
type TokenType string

const (
	TokenTypeAccess  TokenType = "access"
	TokenTypeRefresh TokenType = "refresh"
)

// Claims represents the JWT claims
type Claims struct {
	UserID    string    `json:"user_id"`
	Email     string    `json:"email"`
	Username  string    `json:"username"`
	TokenType TokenType `json:"token_type"`
	jwt.RegisteredClaims
}

// JWTManager handles JWT operations
type JWTManager struct {
	secret          []byte
	accessTokenTTL  time.Duration
	refreshTokenTTL time.Duration
}

// NewJWTManager creates a new JWT manager
func NewJWTManager(secret string, accessTokenTTL, refreshTokenTTL time.Duration) *JWTManager {
	return &JWTManager{
		secret:          []byte(secret),
		accessTokenTTL:  accessTokenTTL,
		refreshTokenTTL: refreshTokenTTL,
	}
}

// TokenPair represents an access and refresh token pair
type TokenPair struct {
	AccessToken     string
	RefreshToken    string
	ExpiresAt       time.Time
	RefreshTokenTTL time.Duration
}

// GenerateTokenPair generates both access and refresh tokens with default refresh TTL
func (m *JWTManager) GenerateTokenPair(userID, email, username string) (*TokenPair, error) {
	return m.GenerateTokenPairWithTTL(userID, email, username, m.refreshTokenTTL)
}

// GenerateTokenPairWithTTL generates tokens with a custom refresh token TTL
func (m *JWTManager) GenerateTokenPairWithTTL(userID, email, username string, refreshTTL time.Duration) (*TokenPair, error) {
	accessToken, err := m.generateToken(userID, email, username, TokenTypeAccess, m.accessTokenTTL)
	if err != nil {
		return nil, err
	}

	refreshToken, err := m.generateToken(userID, email, username, TokenTypeRefresh, refreshTTL)
	if err != nil {
		return nil, err
	}

	return &TokenPair{
		AccessToken:     accessToken,
		RefreshToken:    refreshToken,
		ExpiresAt:       time.Now().Add(m.accessTokenTTL),
		RefreshTokenTTL: refreshTTL,
	}, nil
}

// GenerateAccessToken generates only an access token
func (m *JWTManager) GenerateAccessToken(userID, email, username string) (string, time.Time, error) {
	token, err := m.generateToken(userID, email, username, TokenTypeAccess, m.accessTokenTTL)
	if err != nil {
		return "", time.Time{}, err
	}
	return token, time.Now().Add(m.accessTokenTTL), nil
}

func (m *JWTManager) generateToken(userID, email, username string, tokenType TokenType, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := &Claims{
		UserID:    userID,
		Email:     email,
		Username:  username,
		TokenType: tokenType,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			Issuer:    "zeus",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.secret)
}

// ValidateToken validates a JWT token and returns its claims
func (m *JWTManager) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return m.secret, nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}

	return claims, nil
}

// ValidateAccessToken validates an access token
func (m *JWTManager) ValidateAccessToken(tokenString string) (*Claims, error) {
	claims, err := m.ValidateToken(tokenString)
	if err != nil {
		return nil, err
	}
	if claims.TokenType != TokenTypeAccess {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

// ValidateRefreshToken validates a refresh token
func (m *JWTManager) ValidateRefreshToken(tokenString string) (*Claims, error) {
	claims, err := m.ValidateToken(tokenString)
	if err != nil {
		return nil, err
	}
	if claims.TokenType != TokenTypeRefresh {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

// HashToken creates a SHA256 hash of a token for storage
func HashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

// RefreshTokenTTL returns the refresh token TTL
func (m *JWTManager) RefreshTokenTTL() time.Duration {
	return m.refreshTokenTTL
}
