// main.go
// A minimal Go server that:
// 1) Runs alongside Vite in development, exposing only API/WebSocket endpoints.
// 2) Streams long-running CLI stdout/stderr over WebSockets and supports optional stdin from the client.
// 3) In production, optionally serves the built Vite static files from ./dist while still providing the API/WS.
//
// How to use (development):
// - Run Vite dev server (default http://localhost:5173)
// - Run this Go server (default http://localhost:8080)
// - Configure Vite to proxy /api and /ws to http://localhost:8080 (see vite.config.ts snippet below)
// - Frontend connects to ws://localhost:5173/ws/run (Vite will proxy to Go)
//
// How to use (production):
// - Build your Vite app: `npm run build` → outputs ./dist
// - Start this server with SERVE_STATIC=true (env var) and it will serve ./dist at '/'
// - Frontend will be available on the same port as the API/WS
//
// SECURITY NOTE:
// - This example passes the command to run via query/JSON. In real apps, limit to an allowlist and validate args!
// - Never expose arbitrary command execution on an internet-facing server.

package main

import (
	"bufio"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

//go:embed dist/*
var embeddedDist embed.FS // optional: used when SERVE_STATIC=embed

type runRequest struct {
	Cmd  string   `json:"cmd"`
	Args []string `json:"args"`
	Cwd  string   `json:"cwd,omitempty"`
}

type serverConfig struct {
	Addr           string
	AllowedOrigin  string // e.g., http://localhost:5173 during dev
	ServeStatic    string // "", "true", or "embed"
	StaticDir      string // path to ./dist for static serving
	CommandAllowlist []string // optional allowlist of allowed commands
}

func (c serverConfig) isAllowed(cmd string) bool {
	if len(c.CommandAllowlist) == 0 {
		return true // no allowlist → allow all (NOT for production)
	}
	for _, allowed := range c.CommandAllowlist {
		if cmd == allowed {
			return true
		}
	}
	return false
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  32 * 1024,
	WriteBufferSize: 32 * 1024,
	// CheckOrigin controls which origins may connect (important in dev when using Vite on a different port).
	CheckOrigin: func(r *http.Request) bool { return true }, // tightened below in wsHandler using config
}

func main() {
	cfg := loadConfig()
	log.Printf("Starting server on %s (serveStatic=%s, allowedOrigin=%q)\n", cfg.Addr, cfg.ServeStatic, cfg.AllowedOrigin)

	r := mux.NewRouter()

	// Health check
	r.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}).Methods(http.MethodGet)

	// WebSocket endpoint for running commands with streaming I/O
	r.HandleFunc("/ws/run", func(w http.ResponseWriter, r *http.Request) {
		wsHandler(w, r, cfg)
	}).Methods(http.MethodGet)

	// Optional: plain HTTP endpoint to run a command and return its full output (non-streaming)
	r.HandleFunc("/api/run", func(w http.ResponseWriter, r *http.Request) {
		apiRunHandler(w, r, cfg)
	}).Methods(http.MethodPost)

	// Static file serving (production)
	if strings.EqualFold(cfg.ServeStatic, "true") {
		// Serve from disk directory (cfg.StaticDir)
		static := http.FileServer(http.Dir(cfg.StaticDir))
		r.PathPrefix("/").Handler(spaFallback(static, filepath.Join(cfg.StaticDir, "index.html")))
		log.Printf("Serving static files from %s\n", cfg.StaticDir)
	} else if strings.EqualFold(cfg.ServeStatic, "embed") {
		// Serve from embedded FS built from //go:embed dist/*
		fsys := http.FS(embeddedDist)
		static := http.FileServer(http.StripPrefix("/", http.FileServer(fsys)))
		r.PathPrefix("/").Handler(spaFallback(static, "dist/index.html"))
		log.Printf("Serving static files from embedded FS (dist)")
	}

	srv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      withCors(r, cfg.AllowedOrigin),
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	// Graceful shutdown on SIGINT/SIGTERM would go here if desired
	select {}
}

func loadConfig() serverConfig {
	addr := envOr("ADDR", ":8080")
	allowed := envOr("ALLOWED_ORIGIN", "") // e.g. http://localhost:5173
	serveStatic := envOr("SERVE_STATIC", "") // "true" to serve ./dist, or "embed" to serve from embedded FS
	staticDir := envOr("STATIC_DIR", "dist")

	allowlist := strings.Split(strings.TrimSpace(envOr("COMMAND_ALLOWLIST", "")), ",")
	if len(allowlist) == 1 && allowlist[0] == "" {
		allowlist = nil
	}

	// Allow overriding with flags too
	flag.StringVar(&addr, "addr", addr, "server listen address")
	flag.StringVar(&allowed, "allowed-origin", allowed, "CORS/WebSocket allowed origin (dev: http://localhost:5173)")
	flag.StringVar(&serveStatic, "serve-static", serveStatic, "serve static: '', 'true', or 'embed'")
	flag.StringVar(&staticDir, "static-dir", staticDir, "directory for static files when serve-static=true")
	flag.Parse()

	return serverConfig{
		Addr:             addr,
		AllowedOrigin:    allowed,
		ServeStatic:      serveStatic,
		StaticDir:        staticDir,
		CommandAllowlist: allowlist,
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// wsHandler upgrades to WebSocket, spawns the command, streams stdout/stderr to the client,
// and optionally accepts stdin from the client.
func wsHandler(w http.ResponseWriter, r *http.Request, cfg serverConfig) {
	// Enforce origin in dev if provided
	if cfg.AllowedOrigin != "" {
		upgrader.CheckOrigin = func(r *http.Request) bool {
			return r.Header.Get("Origin") == cfg.AllowedOrigin
		}
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("websocket upgrade: %v", err)
		return
	}
	defer conn.Close()

	// Parse runRequest from query or first message
	var rr runRequest
	if qcmd := r.URL.Query().Get("cmd"); qcmd != "" {
		rr.Cmd = qcmd
		rr.Args = strings.Split(r.URL.Query().Get("args"), ",")
		rr.Cwd = r.URL.Query().Get("cwd")
	} else {
		_, data, err := conn.ReadMessage()
		if err != nil {
			sendJSON(conn, map[string]any{"type": "error", "error": "missing run parameters"})
			return
		}
		if err := json.Unmarshal(data, &rr); err != nil {
			sendJSON(conn, map[string]any{"type": "error", "error": "invalid JSON for run parameters"})
			return
		}
	}

	if rr.Cmd == "" {
		sendJSON(conn, map[string]any{"type": "error", "error": "no command specified"})
		return
	}
	if !cfg.isAllowed(rr.Cmd) {
		sendJSON(conn, map[string]any{"type": "error", "error": "command not allowed"})
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	cmd := exec.CommandContext(ctx, rr.Cmd, rr.Args...)
	if rr.Cwd != "" {
		cmd.Dir = rr.Cwd
	}

	stdin, err := cmd.StdinPipe()
	if err != nil { sendJSON(conn, map[string]any{"type":"error","error":"stdin pipe error"}); return }
	stdout, err := cmd.StdoutPipe()
	if err != nil { sendJSON(conn, map[string]any{"type":"error","error":"stdout pipe error"}); return }
	stderr, err := cmd.StderrPipe()
	if err != nil { sendJSON(conn, map[string]any{"type":"error","error":"stderr pipe error"}); return }

	if err := cmd.Start(); err != nil {
		sendJSON(conn, map[string]any{"type": "error", "error": fmt.Sprintf("start error: %v", err)})
		return
	}
	sendJSON(conn, map[string]any{"type": "started", "pid": cmd.Process.Pid, "cmd": rr.Cmd, "args": rr.Args})

	var wg sync.WaitGroup
	wg.Add(2)

	// Stream stdout
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 64*1024), 10*1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			_ = conn.WriteJSON(map[string]any{"type": "stdout", "data": line})
		}
		if err := scanner.Err(); err != nil {
			_ = conn.WriteJSON(map[string]any{"type": "error", "error": fmt.Sprintf("stdout scan error: %v", err)})
		}
	}()

	// Stream stderr
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 64*1024), 10*1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			_ = conn.WriteJSON(map[string]any{"type": "stderr", "data": line})
		}
		if err := scanner.Err(); err != nil {
			_ = conn.WriteJSON(map[string]any{"type": "error", "error": fmt.Sprintf("stderr scan error: %v", err)})
		}
	}()

	// Reader: accept client messages for stdin / control / keepalive
	go func() {
		for {
			mt, data, err := conn.ReadMessage()
			if err != nil {
				// client disconnected
				cancel()
				return
			}
			if mt != websocket.TextMessage && mt != websocket.BinaryMessage {
				continue
			}
			// Protocol: JSON messages of shape {type: 'stdin'|'signal'|'ping', data?: string}
			var msg map[string]any
			if err := json.Unmarshal(data, &msg); err == nil {
				if t, _ := msg["type"].(string); t != "" {
					switch t {
					case "stdin":
						if s, _ := msg["data"].(string); s != "" {
							_, _ = stdin.Write([]byte(s))
						}
					case "signal":
						if s, _ := msg["data"].(string); s == "SIGINT" {
							_ = cmd.Process.Signal(os.Interrupt)
						}
					case "ping":
						_ = conn.WriteJSON(map[string]any{"type": "pong", "ts": time.Now().UnixNano()})
					}
				}
			}
		}
	}()

	// Periodic ping to keep proxies/load balancers from closing idle WS
	pingTicker := time.NewTicker(20 * time.Second)
	defer pingTicker.Stop()
	go func() {
		for range pingTicker.C {
			_ = conn.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(5*time.Second))
		}
	}()

	// Wait for stdout/stderr to finish then wait on process
	wg.Wait()
	_ = stdin.Close()
	err = cmd.Wait()
	status := map[string]any{"type": "exit"}
	if err != nil {
		status["error"] = err.Error()
	}
	if cmd.ProcessState != nil {
		status["exitCode"] = cmd.ProcessState.ExitCode()
	}
	_ = conn.WriteJSON(status)
}

// apiRunHandler: non-streaming example (for quick tests)
func apiRunHandler(w http.ResponseWriter, r *http.Request, cfg serverConfig) {
	var rr runRequest
	if err := json.NewDecoder(r.Body).Decode(&rr); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if rr.Cmd == "" || !cfg.isAllowed(rr.Cmd) {
		http.Error(w, "command not allowed or missing", http.StatusBadRequest)
		return
	}
	cmd := exec.Command(rr.Cmd, rr.Args...)
	if rr.Cwd != "" { cmd.Dir = rr.Cwd }
	out, err := cmd.CombinedOutput()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"cmd": rr.Cmd, "args": rr.Args, "error": errorString(err), "output": string(out),
	})
}

func errorString(err error) string { if err == nil { return "" }; return err.Error() }

// withCors adds permissive CORS for dev (and sets WS upgrade headers appropriately)
func withCors(next http.Handler, allowedOrigin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if allowedOrigin != "" && origin == allowedOrigin {
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// spaFallback serves index.html for unknown paths to support client-side routing
func spaFallback(static http.Handler, indexPath string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Serve API/WS normally
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/ws/") {
			static.ServeHTTP(w, r)
			return
		}
		// Try to serve the file
		p := r.URL.Path
		if p == "/" || path.Ext(p) == "" { // likely a SPA route
			// Serve index.html
			if strings.HasPrefix(indexPath, "dist/") {
				// embedded FS path
				f, err := embeddedDist.Open(indexPath)
				if err != nil { http.NotFound(w, r); return }
				defer f.Close()
				http.ServeContent(w, r, "index.html", time.Now(), f)
				return
			}
			http.ServeFile(w, r, indexPath)
			return
		}
		static.ServeHTTP(w, r)
	})
}

// --- vite.config.ts (dev proxy) ---
// Place this next to your Vite project (TypeScript). If using JS, use vite.config.js with equivalent fields.
//
// import { defineConfig } from 'vite'
// export default defineConfig({
//   server: {
//     proxy: {
//       '/api': { target: 'http://localhost:8080', changeOrigin: true },
//       '/ws':  { target: 'ws://localhost:8080', ws: true, changeOrigin: true },
//     }
//   }
// })

// --- Example frontend WebSocket client code (TypeScript) ---
// const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/run`);
// ws.addEventListener('open', () => {
//   ws.send(JSON.stringify({ cmd: 'ping', args: ['-c', '5'] })); // example command
// });
// ws.addEventListener('message', (ev) => {
//   const msg = JSON.parse(ev.data);
//   switch (msg.type) {
//     case 'started':   console.log('started', msg); break;
//     case 'stdout':    console.log('OUT:', msg.data); break;
//     case 'stderr':    console.log('ERR:', msg.data); break;
//     case 'exit':      console.log('exit', msg); break;
//     case 'error':     console.error('error', msg.error); break;
//   }
// });
// // To send stdin later:
// // ws.send(JSON.stringify({ type: 'stdin', data: 'some input\n' }));

