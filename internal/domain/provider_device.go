package domain

import "time"

type ProviderDeviceCode struct {
	DeviceCode      string
	UserCode        string
	VerificationURI string
	Interval        int
	ExpiresAt       time.Time
}
