package domain

import "time"

type ProviderDeviceCode struct {
	DeviceCode      string
	UserCode        string
	VerificationURI string
	Interval        int
	ExpiresAt       time.Time
}

type ProviderDevicePollStatus string

const (
	ProviderDevicePollAuthorizedPending ProviderDevicePollStatus = "authorization_pending"
	ProviderDevicePollSlowDown          ProviderDevicePollStatus = "slow_down"
	ProviderDevicePollExpiredToken      ProviderDevicePollStatus = "expired_token"
	ProviderDevicePollAccessDenied      ProviderDevicePollStatus = "access_denied"
	ProviderDevicePollIncorrectClient   ProviderDevicePollStatus = "incorrect_client_credentials"
	ProviderDevicePollBadVerification   ProviderDevicePollStatus = "bad_verification_code"
)

type ProviderDevicePollError struct {
	Status      ProviderDevicePollStatus
	Description string
}

func (e ProviderDevicePollError) Error() string {
	if e.Description != "" {
		return e.Description
	}
	return string(e.Status)
}
