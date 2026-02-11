package service

import (
	"context"
	"testing"
	"time"

	"zeus/internal/domain"
	teampostgres "zeus/internal/modules/team/repository/postgres"
	userrepo "zeus/internal/modules/user/repository"
)

type fakeTeamRepo struct {
	teamsByID       map[string]*domain.Team
	teamsBySlug     map[string]*domain.Team
	membersByTeam   map[string]map[string]*domain.TeamMember
	joinLinksByID   map[string]*domain.TeamJoinLink
	joinLinksByHash map[string]*domain.TeamJoinLink
}

func newFakeTeamRepo() *fakeTeamRepo {
	return &fakeTeamRepo{
		teamsByID:       make(map[string]*domain.Team),
		teamsBySlug:     make(map[string]*domain.Team),
		membersByTeam:   make(map[string]map[string]*domain.TeamMember),
		joinLinksByID:   make(map[string]*domain.TeamJoinLink),
		joinLinksByHash: make(map[string]*domain.TeamJoinLink),
	}
}

func (r *fakeTeamRepo) Create(ctx context.Context, team *domain.Team) error {
	_ = ctx
	r.teamsByID[team.ID] = team
	r.teamsBySlug[team.Slug] = team
	return nil
}

func (r *fakeTeamRepo) GetByID(ctx context.Context, id string) (*domain.Team, error) {
	_ = ctx
	team, ok := r.teamsByID[id]
	if !ok {
		return nil, teampostgres.ErrTeamNotFound
	}
	return team, nil
}

func (r *fakeTeamRepo) GetBySlug(ctx context.Context, slug string) (*domain.Team, error) {
	_ = ctx
	team, ok := r.teamsBySlug[slug]
	if !ok {
		return nil, teampostgres.ErrTeamNotFound
	}
	return team, nil
}

func (r *fakeTeamRepo) Update(ctx context.Context, team *domain.Team) error {
	_ = ctx
	r.teamsByID[team.ID] = team
	r.teamsBySlug[team.Slug] = team
	return nil
}

func (r *fakeTeamRepo) Delete(ctx context.Context, id string) error {
	_ = ctx
	delete(r.teamsByID, id)
	return nil
}

func (r *fakeTeamRepo) ListByUserID(ctx context.Context, userID string) ([]*domain.Team, error) {
	_ = ctx
	_ = userID
	return nil, nil
}

func (r *fakeTeamRepo) ExistsBySlug(ctx context.Context, slug string) (bool, error) {
	_ = ctx
	_, ok := r.teamsBySlug[slug]
	return ok, nil
}

func (r *fakeTeamRepo) AddMember(ctx context.Context, member *domain.TeamMember) error {
	_ = ctx
	if r.membersByTeam[member.TeamID] == nil {
		r.membersByTeam[member.TeamID] = make(map[string]*domain.TeamMember)
	}
	if _, exists := r.membersByTeam[member.TeamID][member.UserID]; exists {
		return teampostgres.ErrMemberExists
	}
	r.membersByTeam[member.TeamID][member.UserID] = member
	return nil
}

func (r *fakeTeamRepo) GetMember(ctx context.Context, teamID, userID string) (*domain.TeamMember, error) {
	_ = ctx
	members := r.membersByTeam[teamID]
	if members == nil {
		return nil, teampostgres.ErrMemberNotFound
	}
	member, ok := members[userID]
	if !ok {
		return nil, teampostgres.ErrMemberNotFound
	}
	return member, nil
}

func (r *fakeTeamRepo) UpdateMemberRole(ctx context.Context, teamID, userID string, role domain.TeamRole) error {
	_ = ctx
	members := r.membersByTeam[teamID]
	if members == nil {
		return teampostgres.ErrMemberNotFound
	}
	member, ok := members[userID]
	if !ok {
		return teampostgres.ErrMemberNotFound
	}
	member.Role = role
	return nil
}

func (r *fakeTeamRepo) RemoveMember(ctx context.Context, teamID, userID string) error {
	_ = ctx
	if r.membersByTeam[teamID] != nil {
		delete(r.membersByTeam[teamID], userID)
	}
	return nil
}

func (r *fakeTeamRepo) ListMembers(ctx context.Context, teamID string) ([]*domain.TeamMember, error) {
	_ = ctx
	members := r.membersByTeam[teamID]
	result := make([]*domain.TeamMember, 0, len(members))
	for _, m := range members {
		result = append(result, m)
	}
	return result, nil
}

func (r *fakeTeamRepo) IsMember(ctx context.Context, teamID, userID string) (bool, error) {
	_ = ctx
	members := r.membersByTeam[teamID]
	if members == nil {
		return false, nil
	}
	_, ok := members[userID]
	return ok, nil
}

func (r *fakeTeamRepo) CreateInvitation(ctx context.Context, invitation *domain.TeamInvitation) error {
	_ = ctx
	_ = invitation
	return nil
}

func (r *fakeTeamRepo) GetInvitation(ctx context.Context, id string) (*domain.TeamInvitation, error) {
	_ = ctx
	_ = id
	return nil, teampostgres.ErrInvitationNotFound
}

func (r *fakeTeamRepo) GetPendingInvitationByEmail(ctx context.Context, teamID, email string) (*domain.TeamInvitation, error) {
	_ = ctx
	_ = teamID
	_ = email
	return nil, teampostgres.ErrInvitationNotFound
}

func (r *fakeTeamRepo) UpdateInvitationStatus(ctx context.Context, id string, status domain.InvitationStatus) error {
	_ = ctx
	_ = id
	_ = status
	return nil
}

func (r *fakeTeamRepo) ListInvitations(ctx context.Context, teamID string) ([]*domain.TeamInvitation, error) {
	_ = ctx
	_ = teamID
	return nil, nil
}

func (r *fakeTeamRepo) ListPendingInvitationsByEmail(ctx context.Context, email string) ([]*domain.TeamInvitation, error) {
	_ = ctx
	_ = email
	return nil, nil
}

func (r *fakeTeamRepo) CreateJoinLink(ctx context.Context, link *domain.TeamJoinLink) error {
	_ = ctx
	r.joinLinksByID[link.ID] = link
	r.joinLinksByHash[link.TokenHash] = link
	return nil
}

func (r *fakeTeamRepo) GetJoinLinkByTokenHash(ctx context.Context, tokenHash string) (*domain.TeamJoinLink, error) {
	_ = ctx
	link, ok := r.joinLinksByHash[tokenHash]
	if !ok {
		return nil, teampostgres.ErrJoinLinkNotFound
	}
	return link, nil
}

func (r *fakeTeamRepo) RevokeActiveJoinLinksByRole(ctx context.Context, teamID string, role domain.TeamRole, now time.Time) error {
	_ = ctx
	for _, link := range r.joinLinksByID {
		if link.TeamID != teamID {
			continue
		}
		if link.Role != role {
			continue
		}
		if link.RevokedAt != nil {
			continue
		}
		if !link.ExpiresAt.After(now) {
			continue
		}
		revokedAt := now
		link.RevokedAt = &revokedAt
	}
	return nil
}

func (r *fakeTeamRepo) TouchJoinLinkUsage(ctx context.Context, id string, usedAt time.Time) error {
	_ = ctx
	link, ok := r.joinLinksByID[id]
	if !ok {
		return teampostgres.ErrJoinLinkNotFound
	}
	at := usedAt
	link.LastUsedAt = &at
	return nil
}

type fakeUserRepo struct{}

func (r *fakeUserRepo) Create(ctx context.Context, user *domain.User) error {
	_ = ctx
	_ = user
	return nil
}

func (r *fakeUserRepo) GetByID(ctx context.Context, id string) (*domain.User, error) {
	_ = ctx
	_ = id
	return nil, nil
}

func (r *fakeUserRepo) GetByEmail(ctx context.Context, email string) (*domain.User, error) {
	_ = ctx
	_ = email
	return nil, nil
}

func (r *fakeUserRepo) GetByUsername(ctx context.Context, username string) (*domain.User, error) {
	_ = ctx
	_ = username
	return nil, nil
}

func (r *fakeUserRepo) Update(ctx context.Context, user *domain.User) error {
	_ = ctx
	_ = user
	return nil
}

func (r *fakeUserRepo) UpdatePassword(ctx context.Context, id string, passwordHash string) error {
	_ = ctx
	_ = id
	_ = passwordHash
	return nil
}

func (r *fakeUserRepo) ExistsByEmail(ctx context.Context, email string) (bool, error) {
	_ = ctx
	_ = email
	return false, nil
}

func (r *fakeUserRepo) ExistsByUsername(ctx context.Context, username string) (bool, error) {
	_ = ctx
	_ = username
	return false, nil
}

var _ userrepo.UserRepository = (*fakeUserRepo)(nil)

func seedTeamRepoForJoinLinkTests() (*fakeTeamRepo, *TeamService, *domain.Team) {
	repo := newFakeTeamRepo()
	svc := NewTeamService(repo, &fakeUserRepo{})
	team := &domain.Team{
		ID:      "team-1",
		Slug:    "team-one",
		Name:    "Team One",
		OwnerID: "owner-1",
		Status:  domain.TeamStatusActive,
	}
	repo.teamsByID[team.ID] = team
	repo.teamsBySlug[team.Slug] = team
	return repo, svc, team
}

func addMember(repo *fakeTeamRepo, teamID, userID string, role domain.TeamRole) {
	if repo.membersByTeam[teamID] == nil {
		repo.membersByTeam[teamID] = make(map[string]*domain.TeamMember)
	}
	repo.membersByTeam[teamID][userID] = &domain.TeamMember{
		ID:     teamID + "-" + userID,
		TeamID: teamID,
		UserID: userID,
		Role:   role,
	}
}

func addJoinLink(repo *fakeTeamRepo, link *domain.TeamJoinLink) {
	repo.joinLinksByID[link.ID] = link
	repo.joinLinksByHash[link.TokenHash] = link
}

func TestCreateJoinLink_DefaultRoleAndRevokePrevious(t *testing.T) {
	repo, svc, team := seedTeamRepoForJoinLinkTests()
	addMember(repo, team.ID, "actor-1", domain.TeamRoleAdmin)

	oldToken := "old-token"
	oldLink := &domain.TeamJoinLink{
		ID:        "link-old",
		TeamID:    team.ID,
		TokenHash: hashJoinToken(oldToken),
		Role:      domain.TeamRoleMember,
		CreatedBy: "actor-1",
		ExpiresAt: time.Now().Add(2 * time.Hour),
		CreatedAt: time.Now().Add(-10 * time.Minute),
	}
	addJoinLink(repo, oldLink)

	startedAt := time.Now()
	result, err := svc.CreateJoinLink(context.Background(), "actor-1", team.Slug, CreateJoinLinkInput{})
	if err != nil {
		t.Fatalf("CreateJoinLink returned error: %v", err)
	}
	if result == nil || result.Link == nil {
		t.Fatalf("CreateJoinLink returned nil result/link")
	}
	if result.Token == "" {
		t.Fatalf("CreateJoinLink returned empty token")
	}
	if result.Link.Role != domain.TeamRoleMember {
		t.Fatalf("expected default role member, got %s", result.Link.Role)
	}
	if result.Link.TokenHash != hashJoinToken(result.Token) {
		t.Fatalf("stored token hash does not match returned token")
	}
	if oldLink.RevokedAt == nil {
		t.Fatalf("expected old active link to be revoked")
	}

	expiresDelta := result.Link.ExpiresAt.Sub(startedAt)
	if expiresDelta < joinLinkTTL-3*time.Second || expiresDelta > joinLinkTTL+3*time.Second {
		t.Fatalf("expected expires_at around %v, got delta %v", joinLinkTTL, expiresDelta)
	}
}

func TestGetJoinLinkPreview_ExpiredLink(t *testing.T) {
	repo, svc, team := seedTeamRepoForJoinLinkTests()

	token := "expired-token"
	addJoinLink(repo, &domain.TeamJoinLink{
		ID:        "link-expired",
		TeamID:    team.ID,
		TokenHash: hashJoinToken(token),
		Role:      domain.TeamRoleViewer,
		CreatedBy: "actor-1",
		ExpiresAt: time.Now().Add(-1 * time.Minute),
		CreatedAt: time.Now().Add(-10 * time.Minute),
	})

	preview, err := svc.GetJoinLinkPreview(context.Background(), token)
	if err != ErrJoinLinkExpired {
		t.Fatalf("expected ErrJoinLinkExpired, got %v", err)
	}
	if preview != nil {
		t.Fatalf("expected nil preview when link expired")
	}
}

func TestJoinByLink_IdempotentWhenAlreadyMember(t *testing.T) {
	repo, svc, team := seedTeamRepoForJoinLinkTests()

	token := "join-token"
	link := &domain.TeamJoinLink{
		ID:        "link-1",
		TeamID:    team.ID,
		TokenHash: hashJoinToken(token),
		Role:      domain.TeamRoleViewer,
		CreatedBy: "actor-1",
		ExpiresAt: time.Now().Add(1 * time.Hour),
		CreatedAt: time.Now(),
	}
	addJoinLink(repo, link)
	addMember(repo, team.ID, "user-1", domain.TeamRoleAdmin)

	joinedTeam, err := svc.JoinByLink(context.Background(), "user-1", token)
	if err != nil {
		t.Fatalf("JoinByLink returned error: %v", err)
	}
	if joinedTeam == nil || joinedTeam.ID != team.ID {
		t.Fatalf("unexpected joined team result: %+v", joinedTeam)
	}
	member, err := repo.GetMember(context.Background(), team.ID, "user-1")
	if err != nil {
		t.Fatalf("GetMember returned error: %v", err)
	}
	if member.Role != domain.TeamRoleAdmin {
		t.Fatalf("expected existing role to remain admin, got %s", member.Role)
	}
	if link.LastUsedAt == nil {
		t.Fatalf("expected join link last_used_at to be updated")
	}
}

func TestJoinByLink_NotFound(t *testing.T) {
	_, svc, _ := seedTeamRepoForJoinLinkTests()

	joinedTeam, err := svc.JoinByLink(context.Background(), "user-1", "missing-token")
	if err != ErrJoinLinkNotFound {
		t.Fatalf("expected ErrJoinLinkNotFound, got %v", err)
	}
	if joinedTeam != nil {
		t.Fatalf("expected nil team when link not found")
	}
}

func TestGetJoinLinkPreview_RevokedLink(t *testing.T) {
	repo, svc, team := seedTeamRepoForJoinLinkTests()

	token := "revoked-token"
	revokedAt := time.Now().Add(-1 * time.Minute)
	addJoinLink(repo, &domain.TeamJoinLink{
		ID:        "link-revoked",
		TeamID:    team.ID,
		TokenHash: hashJoinToken(token),
		Role:      domain.TeamRoleMember,
		CreatedBy: "actor-1",
		ExpiresAt: time.Now().Add(1 * time.Hour),
		RevokedAt: &revokedAt,
		CreatedAt: time.Now().Add(-10 * time.Minute),
	})

	preview, err := svc.GetJoinLinkPreview(context.Background(), token)
	if err != ErrJoinLinkExpired {
		t.Fatalf("expected ErrJoinLinkExpired for revoked link, got %v", err)
	}
	if preview != nil {
		t.Fatalf("expected nil preview for revoked link")
	}
}

func TestCreateJoinLink_NonManagerForbidden(t *testing.T) {
	repo, svc, team := seedTeamRepoForJoinLinkTests()
	addMember(repo, team.ID, "actor-1", domain.TeamRoleMember)

	result, err := svc.CreateJoinLink(context.Background(), "actor-1", team.Slug, CreateJoinLinkInput{
		Role: domain.TeamRoleViewer,
	})
	if err != ErrNotAuthorized {
		t.Fatalf("expected ErrNotAuthorized, got %v", err)
	}
	if result != nil {
		t.Fatalf("expected nil result when not authorized")
	}
}
