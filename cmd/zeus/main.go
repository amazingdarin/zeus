package main

import (
	"context"

	"zeus/internal/app"
)

func main() {
	ctx := context.Background()
	router := app.BuildRouter(ctx)
	port := app.Getenv("ZEUS_PORT", "8080")
	if port == "" {
		port = "8080"
	}
	if err := router.Run("0.0.0.0:" + port); err != nil {
		panic(err)
	}
}
