package main

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestServerIntegration(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Error getting current working directory: %v", err)
	}
	t.Logf("Current working directory: %s", dir)

	// Build path to server binary (assumes built already: go build)
	// Joining the full path works; joining "." does not - why not?
	serverPath := filepath.Join(dir, "srv")
	if _, err := os.Stat(serverPath); err != nil {
		t.Fatalf("server binary not found at %s; did you build it?", serverPath)
	}

	// Start server with /bin/cat as the command
	cmd := exec.CommandContext(ctx, serverPath, "--cmd=/bin/cat")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatalf("failed to start server: %v", err)
	}

	defer func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}()

	// Allow server a moment to start
	time.Sleep(500 * time.Millisecond)

	baseURL := "http://localhost:8080"

	// Step 1: /api/health
	resp, err := http.Get(baseURL + "/api/health")
	if err != nil {
		t.Fatalf("/api/health request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("/api/health returned status %d", resp.StatusCode)
	}
	t.Logf("/api/health succeeded")

	// Step 2: /ws/run
	dialer := websocket.Dialer{}
	wsURL := "ws://localhost:8080/ws/run"
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial websocket: %v", err)
	}
	defer conn.Close()
	t.Logf("WebSocket connection established")

	// confirm the "started" response
	var recv map[string]any
	if err := conn.ReadJSON(&recv); err != nil {
		t.Fatalf("failed to read from websocket: %v", err)
	}
	if recv["type"] != "started" {
		t.Fatalf("expected type 'started', got %v", recv["type"])
	}
	t.Logf("Received expected type: %v", recv["type"])

	// Step 3 - send stdin
	msg := map[string]string{"type": "stdin", "data": "hello\n"}
	if err := conn.WriteJSON(msg); err != nil {
		t.Fatalf("failed to send stdin: %v", err)
	}
	t.Logf("Sent stdin to /bin/cat")

	if err := conn.ReadJSON(&recv); err != nil {
		t.Fatalf("failed to read from websocket: %v", err)
	}
	if recv["type"] != "stdout" {
		t.Fatalf("expected type 'started', got %v", recv["type"])
	}
	t.Logf("Received expected type: %v", recv["type"])
}
