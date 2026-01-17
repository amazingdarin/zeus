package util

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"strings"

	"zeus/internal/config"
)

type MasterKey struct {
	ID      string
	Version int
	Key     []byte
}

type KeyManager interface {
	ActiveKey() (MasterKey, error)
	Key(id string, version int) (MasterKey, error)
}

type LocalKeyManager struct {
	keys       map[string]map[int]MasterKey
	activeKey  MasterKey
	activeInit bool
}

func NewLocalKeyManager(cfg config.SecurityConfig) (*LocalKeyManager, error) {
	keys := make(map[string]map[int]MasterKey)
	var active MasterKey

	if len(cfg.EncryptionKeys) == 0 {
		fallback := strings.TrimSpace(cfg.EncryptionKey)
		if fallback == "" {
			return nil, fmt.Errorf("encryption key is required")
		}
		active = MasterKey{
			ID:      "legacy",
			Version: 1,
			Key:     deriveKey(fallback),
		}
		keys[active.ID] = map[int]MasterKey{active.Version: active}
		return &LocalKeyManager{keys: keys, activeKey: active, activeInit: true}, nil
	}

	for _, entry := range cfg.EncryptionKeys {
		id := strings.TrimSpace(entry.ID)
		if id == "" {
			return nil, fmt.Errorf("encryption key id is required")
		}
		if entry.Version <= 0 {
			return nil, fmt.Errorf("encryption key version is required")
		}
		raw := strings.TrimSpace(entry.Key)
		if raw == "" {
			return nil, fmt.Errorf("encryption key material is required")
		}
		decoded, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			return nil, fmt.Errorf("decode master key %s: %w", id, err)
		}
		if len(decoded) != 32 {
			return nil, fmt.Errorf("master key %s must be 32 bytes", id)
		}
		mk := MasterKey{ID: id, Version: entry.Version, Key: decoded}
		if keys[id] == nil {
			keys[id] = make(map[int]MasterKey)
		}
		keys[id][entry.Version] = mk
	}

	activeID := strings.TrimSpace(cfg.ActiveKeyID)
	activeVersion := cfg.ActiveKeyVersion
	if activeID == "" || activeVersion == 0 {
		first := cfg.EncryptionKeys[0]
		activeID = strings.TrimSpace(first.ID)
		activeVersion = first.Version
	}
	activeKey, ok := keys[activeID][activeVersion]
	if !ok {
		return nil, fmt.Errorf("active key not found: %s/%d", activeID, activeVersion)
	}
	return &LocalKeyManager{keys: keys, activeKey: activeKey, activeInit: true}, nil
}

func (m *LocalKeyManager) ActiveKey() (MasterKey, error) {
	if m == nil || !m.activeInit {
		return MasterKey{}, fmt.Errorf("key manager not initialized")
	}
	return m.activeKey, nil
}

func (m *LocalKeyManager) Key(id string, version int) (MasterKey, error) {
	if m == nil {
		return MasterKey{}, fmt.Errorf("key manager not initialized")
	}
	id = strings.TrimSpace(id)
	if id == "" || version <= 0 {
		return MasterKey{}, fmt.Errorf("key id and version are required")
	}
	versions, ok := m.keys[id]
	if !ok {
		return MasterKey{}, fmt.Errorf("key not found: %s/%d", id, version)
	}
	mk, ok := versions[version]
	if !ok {
		return MasterKey{}, fmt.Errorf("key not found: %s/%d", id, version)
	}
	return mk, nil
}

type Envelope struct {
	Ciphertext   string
	Nonce        string
	EncryptedKey string
	KeyID        string
	KeyVersion   int
}

func EncryptEnvelope(plaintext []byte, km KeyManager) (Envelope, error) {
	if km == nil {
		return Envelope{}, fmt.Errorf("key manager is required")
	}
	active, err := km.ActiveKey()
	if err != nil {
		return Envelope{}, err
	}
	dataKey := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, dataKey); err != nil {
		return Envelope{}, fmt.Errorf("data key: %w", err)
	}
	payloadNonce, payloadCipher, err := encryptBytes(plaintext, dataKey)
	if err != nil {
		return Envelope{}, err
	}
	wrapNonce, wrapCipher, err := encryptBytes(dataKey, active.Key)
	if err != nil {
		return Envelope{}, err
	}
	wrapped := append(wrapNonce, wrapCipher...)
	return Envelope{
		Ciphertext:   base64.StdEncoding.EncodeToString(payloadCipher),
		Nonce:        base64.StdEncoding.EncodeToString(payloadNonce),
		EncryptedKey: base64.StdEncoding.EncodeToString(wrapped),
		KeyID:        active.ID,
		KeyVersion:   active.Version,
	}, nil
}

func DecryptEnvelope(env Envelope, km KeyManager) ([]byte, error) {
	if km == nil {
		return nil, fmt.Errorf("key manager is required")
	}
	keyID := strings.TrimSpace(env.KeyID)
	if keyID == "" || env.KeyVersion == 0 {
		return nil, fmt.Errorf("key id and version are required")
	}
	masterKey, err := km.Key(keyID, env.KeyVersion)
	if err != nil {
		return nil, err
	}
	wrapped, err := base64.StdEncoding.DecodeString(strings.TrimSpace(env.EncryptedKey))
	if err != nil {
		return nil, fmt.Errorf("decode encrypted key: %w", err)
	}
	dataKey, err := decryptWrappedKey(wrapped, masterKey.Key)
	if err != nil {
		return nil, err
	}
	payloadNonce, err := base64.StdEncoding.DecodeString(strings.TrimSpace(env.Nonce))
	if err != nil {
		return nil, fmt.Errorf("decode payload nonce: %w", err)
	}
	payloadCipher, err := base64.StdEncoding.DecodeString(strings.TrimSpace(env.Ciphertext))
	if err != nil {
		return nil, fmt.Errorf("decode ciphertext: %w", err)
	}
	plaintext, err := decryptBytes(payloadNonce, payloadCipher, dataKey)
	if err != nil {
		return nil, err
	}
	return plaintext, nil
}

func encryptBytes(plaintext []byte, key []byte) ([]byte, []byte, error) {
	if len(key) != 32 {
		return nil, nil, fmt.Errorf("encryption key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, fmt.Errorf("init cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, fmt.Errorf("init gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, fmt.Errorf("nonce: %w", err)
	}
	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)
	return nonce, ciphertext, nil
}

func decryptBytes(nonce []byte, ciphertext []byte, key []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("encryption key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("init cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("init gcm: %w", err)
	}
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt: %w", err)
	}
	return plaintext, nil
}

func decryptWrappedKey(data []byte, masterKey []byte) ([]byte, error) {
	block, err := aes.NewCipher(masterKey)
	if err != nil {
		return nil, fmt.Errorf("init cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("init gcm: %w", err)
	}
	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return nil, fmt.Errorf("encrypted key too short")
	}
	nonce := data[:nonceSize]
	ciphertext := data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt wrapped key: %w", err)
	}
	return plaintext, nil
}
