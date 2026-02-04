package model

import "time"

type Team struct {
	ID          string    `gorm:"column:id;primaryKey"`
	Slug        string    `gorm:"column:slug;not null;unique"`
	Name        string    `gorm:"column:name;not null"`
	Description string    `gorm:"column:description"`
	AvatarURL   string    `gorm:"column:avatar_url"`
	OwnerID     string    `gorm:"column:owner_id;not null"`
	Status      string    `gorm:"column:status;not null;default:active"`
	CreatedAt   time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt   time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (Team) TableName() string {
	return "team"
}

type TeamMember struct {
	ID        string    `gorm:"column:id;primaryKey"`
	TeamID    string    `gorm:"column:team_id;not null"`
	UserID    string    `gorm:"column:user_id;not null"`
	Role      string    `gorm:"column:role;not null;default:member"`
	JoinedAt  time.Time `gorm:"column:joined_at;autoCreateTime"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime"`
}

func (TeamMember) TableName() string {
	return "team_member"
}

type TeamInvitation struct {
	ID        string    `gorm:"column:id;primaryKey"`
	TeamID    string    `gorm:"column:team_id;not null"`
	Email     string    `gorm:"column:email;not null"`
	Role      string    `gorm:"column:role;not null;default:member"`
	InvitedBy string    `gorm:"column:invited_by;not null"`
	Status    string    `gorm:"column:status;not null;default:pending"`
	ExpiresAt time.Time `gorm:"column:expires_at;not null"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime"`
}

func (TeamInvitation) TableName() string {
	return "team_invitation"
}
