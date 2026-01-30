package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type CopilotDeviceClient struct {
	client   *http.Client
	clientID string
	scopes   []string
}

func NewCopilotDeviceClient(clientID string, scopes []string) *CopilotDeviceClient {
	clientID = strings.TrimSpace(clientID)
	if len(scopes) == 0 {
		scopes = []string{"read:user"}
	}
	return &CopilotDeviceClient{
		client:   &http.Client{Timeout: 15 * time.Second},
		clientID: clientID,
		scopes:   scopes,
	}
}

type DeviceCodeResponse struct {
	DeviceCode      string
	UserCode        string
	VerificationURI string
	ExpiresIn       int
	Interval        int
}

type DeviceTokenResponse struct {
	AccessToken string
	TokenType   string
	Scope       string
	ExpiresIn   int
	Error       string
	ErrorDesc   string
}

func (c *CopilotDeviceClient) Start(ctx context.Context) (DeviceCodeResponse, error) {
	if c == nil || c.client == nil {
		return DeviceCodeResponse{}, fmt.Errorf("copilot device client not initialized")
	}
	if c.clientID == "" {
		return DeviceCodeResponse{}, fmt.Errorf("copilot client_id is required")
	}
	form := url.Values{}
	form.Set("client_id", c.clientID)
	form.Set("scope", strings.Join(c.scopes, " "))
	endpoint := "https://github.com/login/device/code"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewBufferString(form.Encode()))
	if err != nil {
		return DeviceCodeResponse{}, fmt.Errorf("build device code request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := c.client.Do(req)
	if err != nil {
		return DeviceCodeResponse{}, fmt.Errorf("device code request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return DeviceCodeResponse{}, fmt.Errorf("device code status %d", resp.StatusCode)
	}
	var payload struct {
		DeviceCode      string `json:"device_code"`
		UserCode        string `json:"user_code"`
		VerificationURI string `json:"verification_uri"`
		ExpiresIn       int    `json:"expires_in"`
		Interval        int    `json:"interval"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return DeviceCodeResponse{}, fmt.Errorf("decode device code response: %w", err)
	}
	return DeviceCodeResponse{
		DeviceCode:      strings.TrimSpace(payload.DeviceCode),
		UserCode:        strings.TrimSpace(payload.UserCode),
		VerificationURI: strings.TrimSpace(payload.VerificationURI),
		ExpiresIn:       payload.ExpiresIn,
		Interval:        payload.Interval,
	}, nil
}

func (c *CopilotDeviceClient) Poll(ctx context.Context, deviceCode string) (DeviceTokenResponse, error) {
	if c == nil || c.client == nil {
		return DeviceTokenResponse{}, fmt.Errorf("copilot device client not initialized")
	}
	deviceCode = strings.TrimSpace(deviceCode)
	if deviceCode == "" {
		return DeviceTokenResponse{}, fmt.Errorf("device code is required")
	}
	if c.clientID == "" {
		return DeviceTokenResponse{}, fmt.Errorf("copilot client_id is required")
	}
	form := url.Values{}
	form.Set("client_id", c.clientID)
	form.Set("device_code", deviceCode)
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
	endpoint := "https://github.com/login/oauth/access_token"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewBufferString(form.Encode()))
	if err != nil {
		return DeviceTokenResponse{}, fmt.Errorf("build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := c.client.Do(req)
	if err != nil {
		return DeviceTokenResponse{}, fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return DeviceTokenResponse{}, fmt.Errorf("token status %d", resp.StatusCode)
	}
	var payload struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		Scope       string `json:"scope"`
		ExpiresIn   int    `json:"expires_in"`
		Error       string `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return DeviceTokenResponse{}, fmt.Errorf("decode token response: %w", err)
	}
	return DeviceTokenResponse{
		AccessToken: strings.TrimSpace(payload.AccessToken),
		TokenType:   strings.TrimSpace(payload.TokenType),
		Scope:       strings.TrimSpace(payload.Scope),
		ExpiresIn:   payload.ExpiresIn,
		Error:       strings.TrimSpace(payload.Error),
		ErrorDesc:   strings.TrimSpace(payload.ErrorDesc),
	}, nil
}
