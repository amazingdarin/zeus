package handler

import (
	"context"

	"github.com/gin-gonic/gin"

	coremiddleware "zeus/internal/core/middleware"
	"zeus/internal/infra/jwt"
	authapi "zeus/internal/modules/auth/api"
	authsvc "zeus/internal/modules/auth/service"
	projectapi "zeus/internal/modules/project/api"
	projectservice "zeus/internal/modules/project/service"
	teamapi "zeus/internal/modules/team/api"
	teamsvc "zeus/internal/modules/team/service"
	userapi "zeus/internal/modules/user/api"
	usersvc "zeus/internal/modules/user/service"
)

// teamIDsGetterAdapter adapts TeamService to implement TeamIDsGetter
type teamIDsGetterAdapter struct {
	teamSvc *teamsvc.TeamService
}

func (a *teamIDsGetterAdapter) GetTeamIDsForUser(userID string) []string {
	if a.teamSvc == nil {
		return nil
	}
	teams, err := a.teamSvc.ListByUser(context.Background(), userID)
	if err != nil {
		return nil
	}
	ids := make([]string, 0, len(teams))
	for _, t := range teams {
		ids = append(ids, t.ID)
	}
	return ids
}

// Services contains all service dependencies for route handlers
type Services struct {
	ProjectSvc projectservice.ProjectService
	AuthSvc    *authsvc.AuthService
	UserSvc    *usersvc.UserService
	TeamSvc    *teamsvc.TeamService
	JWTManager *jwt.JWTManager
}

func RegisterRoutes(
	r *gin.Engine,
	services Services,
) {
	teamIDsGetter := &teamIDsGetterAdapter{teamSvc: services.TeamSvc}
	projectHandler := projectapi.NewProjectHandler(services.ProjectSvc, teamIDsGetter)
	systemHandler := projectapi.NewSystemHandler()
	authHandler := authapi.NewAuthHandler(services.AuthSvc)
	userHandler := userapi.NewUserHandler(services.UserSvc)
	teamHandler := teamapi.NewTeamHandler(services.TeamSvc)

	api := r.Group("/api")

	// System
	api.GET("/system", systemHandler.Get)

	// Auth (public routes)
	auth := api.Group("/auth")
	{
		auth.POST("/register", authHandler.Register)
		auth.POST("/login", authHandler.Login)
		auth.POST("/logout", authHandler.Logout)
		auth.POST("/refresh", authHandler.Refresh)
	}

	// Auth (protected routes)
	authProtected := api.Group("/auth")
	authProtected.Use(coremiddleware.AuthMiddleware(services.JWTManager))
	{
		authProtected.GET("/me", authHandler.Me)
	}

	// User routes
	users := api.Group("/users")
	{
		// Public user profile
		users.GET("/:username", userHandler.GetPublicProfile)
	}
	usersProtected := api.Group("/users")
	usersProtected.Use(coremiddleware.AuthMiddleware(services.JWTManager))
	{
		usersProtected.GET("/me", userHandler.GetProfile)
		usersProtected.PUT("/me", userHandler.UpdateProfile)
		usersProtected.PUT("/me/password", userHandler.ChangePassword)
	}

	// Team routes (protected)
	teams := api.Group("/teams")
	teams.Use(coremiddleware.AuthMiddleware(services.JWTManager))
	{
		teams.POST("", teamHandler.Create)
		teams.GET("", teamHandler.List)
		teams.GET("/:slug", teamHandler.Get)
		teams.PUT("/:slug", teamHandler.Update)
		teams.DELETE("/:slug", teamHandler.Delete)
		teams.GET("/:slug/members", teamHandler.ListMembers)
		teams.POST("/:slug/members", teamHandler.AddMember)
		teams.PUT("/:slug/members/:userId", teamHandler.UpdateMemberRole)
		teams.DELETE("/:slug/members/:userId", teamHandler.RemoveMember)
		teams.GET("/:slug/invitations", teamHandler.ListInvitations)
		teams.POST("/:slug/invitations", teamHandler.InviteMember)
	}

	// Invitation routes (protected)
	invitations := api.Group("/invitations")
	invitations.Use(coremiddleware.AuthMiddleware(services.JWTManager))
	{
		invitations.GET("/pending", teamHandler.GetPendingInvitations)
		invitations.POST("/:id/accept", teamHandler.AcceptInvitation)
	}

	// Project (multi-tenant management) - protected routes
	projects := api.Group("/projects")
	projects.Use(coremiddleware.AuthMiddleware(services.JWTManager))
	{
		projects.POST("", projectHandler.Create)
		projects.GET("", projectHandler.List)
	}
}
