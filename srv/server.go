// main.go
// Minimal Gorilla-based Go server for a single, preconfigured CLI with streaming WebSocket I/O.
//
// Dev mode: run alongside Vite; only exposes /api and /ws. Use Vite proxy to forward requests.
// Prod mode: also serves Vite-built static files from ./dist or from an embedded FS.
// Security: the CLI path is configured at startup (flag/env).
// WS streaming: /ws/run spawns the CLI with the current options; streams stdout/stderr,
//    accepts stdin via messages, and reports exit status.
//
// Flags / env vars:
//   --addr (ADDR)                : listen address (default ":8080")
//   --allowed-origin (ALLOWED_ORIGIN): allow Origin for CORS/WS in dev (e.g., http://localhost:5173)
//   --serve-static (SERVE_STATIC): "" | "fs" | "embed"  ("fs" serves ./dist from disk, "embed" serves embedded dist)
//   --static-dir (STATIC_DIR)    : directory for static files when serve-static=fs (default "dist")
//   --cmd (CLI_CMD)              : REQUIRED. Path to the CLI to run (e.g., "./mytool" or "ffmpeg")
//   --cmd-args (CLI_ARGS)        : OPTIONAL. Comma-separated fixed args always passed before options (e.g., "--fast,-n,10")
//
// Endpoints:
//   GET  /api/health      HTTP GET: {"ok":true|"error":"message"}
//   GET  /ws/run          WebSocket: server immediately starts the configured CLI with current options
//                         Messages from server: {type:"started"|"stdout"|"stderr"|"exit"|"error", ...}
//                         Messages to server  : {type:"stdin"|"signal"|"ping", data?: string}
//
// vite.config.ts (dev proxy):
//   export default defineConfig({
//     server: { proxy: {
//       '/api': { target: 'http://localhost:8080', changeOrigin: true },
//       '/ws':  { target: 'ws://localhost:8080', ws: true, changeOrigin: true },
//     } }
//   })

package main

import (
    "bufio"
    "bytes"
    "context"
    "embed"
    "encoding/json"
    "errors"
    "flag"
    "fmt"
    "io/fs"
    "log"
    "net/http"
    "os"
    "os/exec"
    "path"
    "path/filepath"
    "sort"
    "strings"
    "sync"
    "time"

    "github.com/gorilla/mux"
    "github.com/gorilla/websocket"
)

// --- Embedded frontend (optional) ---
//go:embed dist
var embeddedDist embed.FS // contains the "dist" directory created by `npm run build`

// --- Config and state ---

type serverConfig struct {
    Addr          string
    AllowedOrigin string
    ServeStatic   string // "", "fs", "embed"
    StaticDir     string
    CommandPath   string   // REQUIRED: the CLI to execute
    FixedArgs     []string // from CLI_ARGS (comma-separated)
}

var upgrader = websocket.Upgrader{
    ReadBufferSize:  32 * 1024,
    WriteBufferSize: 32 * 1024,
    CheckOrigin: func(r *http.Request) bool { return true }, // tightened per-request below
}

func main() {
    cfg, err := loadConfig()
    if err != nil {
        log.Fatalf("config error: %v", err)
    }
    log.Printf("Starting server on %s (serveStatic=%s, allowedOrigin=%q, cmd=%q)\n",
        cfg.Addr, cfg.ServeStatic, cfg.AllowedOrigin, cfg.CommandPath)

    r := mux.NewRouter()

    // Healthcheck
    r.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(http.StatusOK)
        _, _ = w.Write([]byte(`{"ok":true}`))
    }).Methods(http.MethodGet)

    // WebSocket run endpoint
    r.HandleFunc("/ws/run", func(w http.ResponseWriter, r *http.Request) { wsRunHandler(w, r, cfg) }).Methods(http.MethodGet)

    // Static serving (prod)
    switch strings.ToLower(cfg.ServeStatic) {
    case "fs":
        static := http.FileServer(http.Dir(cfg.StaticDir))
        r.PathPrefix("/").Handler(spaFallbackFS(static, filepath.Join(cfg.StaticDir, "index.html")))
        log.Printf("Serving static files from disk: %s", cfg.StaticDir)
    case "embed":
        distFS, err := fs.Sub(embeddedDist, "dist")
        if err != nil {
            log.Fatalf("embed fs error: %v", err)
        }
        static := http.FileServer(http.FS(distFS))
        r.PathPrefix("/").Handler(spaFallbackEmbed(static, distFS))
        log.Printf("Serving static files from embedded dist/")
    default:
        // no static serving in dev; only API/WS
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

    // Block forever (or implement graceful shutdown if you like)
    select {}
}

func loadConfig() (serverConfig, error) {
    addr := envOr("ADDR", ":8080")
    allowed := envOr("ALLOWED_ORIGIN", "")
    serveStatic := envOr("SERVE_STATIC", "") // "", "fs", "embed"
    staticDir := envOr("STATIC_DIR", "dist")
    cmdPath := envOr("CLI_CMD", "")
    fixedArgStr := envOr("CLI_ARGS", "")

    flag.StringVar(&addr, "addr", addr, "server listen address")
    flag.StringVar(&allowed, "allowed-origin", allowed, "allowed Origin for CORS/WS (dev: http://localhost:5173)")
    flag.StringVar(&serveStatic, "serve-static", serveStatic, "static mode: '', 'fs', or 'embed'")
    flag.StringVar(&staticDir, "static-dir", staticDir, "directory for static files when serve-static=fs")
    flag.StringVar(&cmdPath, "cmd", cmdPath, "REQUIRED: path to CLI to execute")
    flag.StringVar(&fixedArgStr, "cmd-args", fixedArgStr, "optional comma-separated fixed args passed before options")
    flag.Parse()

    if cmdPath == "" {
        return serverConfig{}, fmt.Errorf("--cmd (or CLI_CMD) is required")
    }

    var fixedArgs []string
    if s := strings.TrimSpace(fixedArgStr); s != "" {
        // Simple CSV split; if you need quoting, extend this.
        parts := strings.Split(s, ",")
        for _, p := range parts {
            p = strings.TrimSpace(p)
            if p != "" { fixedArgs = append(fixedArgs, p) }
        }
    }

    return serverConfig{
        Addr:          addr,
        AllowedOrigin: allowed,
        ServeStatic:   serveStatic,
        StaticDir:     staticDir,
        CommandPath:   cmdPath,
        FixedArgs:     fixedArgs,
    }, nil
}

func envOr(key, def string) string {
    if v := os.Getenv(key); v != "" { return v }
    return def
}

// --- Handlers ---

// wsRunHandler upgrades to WS, starts the preconfigured CLI, streams stdout/stderr, accepts stdin, and reports exit.
func wsRunHandler(w http.ResponseWriter, r *http.Request, cfg serverConfig) {
    // Tighten origin per request
    if cfg.AllowedOrigin != "" {
        upgrader.CheckOrigin = func(r *http.Request) bool { return r.Header.Get("Origin") == cfg.AllowedOrigin }
    }
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil { log.Printf("ws upgrade: %v", err); return }
    defer conn.Close()

    ctx, cancel := context.WithCancel(r.Context())
    defer cancel()

    cmd := exec.CommandContext(ctx, cfg.CommandPath, cfg.FixedArgs...)

    stdin, err := cmd.StdinPipe()
    if err != nil { sendJSON(conn, map[string]any{"type":"error","error":"stdin pipe error"}); return }
    stdout, err := cmd.StdoutPipe()
    if err != nil { sendJSON(conn, map[string]any{"type":"error","error":"stdout pipe error"}); return }
    stderr, err := cmd.StderrPipe()
    if err != nil { sendJSON(conn, map[string]any{"type":"error","error":"stderr pipe error"}); return }

    if err := cmd.Start(); err != nil {
        sendJSON(conn, map[string]any{"type":"error","error":fmt.Sprintf("start error: %v", err)})
        return
    }
    sendJSON(conn, map[string]any{"type":"started","pid":cmd.Process.Pid,"cmd":cfg.CommandPath})

    var wg sync.WaitGroup
    wg.Add(2)

    // Stream stdout lines
    go func() {
        defer wg.Done()
        scanner := bufio.NewScanner(stdout)
        scanner.Buffer(make([]byte, 64*1024), 10*1024*1024)
        for scanner.Scan() { sendJSON(conn, map[string]any{"type":"stdout","data":scanner.Text()}) }
        if err := scanner.Err(); err != nil { sendJSON(conn, map[string]any{"type":"error","error":fmt.Sprintf("stdout scan error: %v", err)}) }
    }()

    // Stream stderr lines
    go func() {
        defer wg.Done()
        scanner := bufio.NewScanner(stderr)
        scanner.Buffer(make([]byte, 64*1024), 10*1024*1024)
        for scanner.Scan() { sendJSON(conn, map[string]any{"type":"stderr","data":scanner.Text()}) }
        if err := scanner.Err(); err != nil { sendJSON(conn, map[string]any{"type":"error","error":fmt.Sprintf("stderr scan error: %v", err)}) }
    }()

    // Reader: stdin/signal/keepalive
    go func() {
        for {
            mt, data, err := conn.ReadMessage()
            if err != nil { cancel(); return }
            if mt != websocket.TextMessage && mt != websocket.BinaryMessage { continue }
            var msg map[string]any
            if json.Unmarshal(data, &msg) == nil {
                switch msg["type"] {
                case "stdin":
                    if s, _ := msg["data"].(string); s != "" { _, _ = stdin.Write([]byte(s)) }
                case "signal":
                    if s, _ := msg["data"].(string); s == "SIGINT" { _ = cmd.Process.Signal(os.Interrupt) }
                case "ping":
                    sendJSON(conn, map[string]any{"type":"pong","ts":time.Now().UnixNano()})
                }
            }
        }
    }()

    // Periodic WS ping (helps keep long sessions alive through proxies)
    pingTicker := time.NewTicker(20 * time.Second)
    defer pingTicker.Stop()
    go func() {
        for range pingTicker.C {
            _ = conn.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(5*time.Second))
        }
    }()

    // wait streams, then wait process
    wg.Wait()
    _ = stdin.Close()
    err = cmd.Wait()
    status := map[string]any{"type":"exit"}
    if err != nil { status["error"] = err.Error() }
    if cmd.ProcessState != nil { status["exitCode"] = cmd.ProcessState.ExitCode() }
    sendJSON(conn, status)
}

// --- Helpers ---

func sendJSON(conn *websocket.Conn, v any) {
    // Best-effort send; ignore errors if the client is gone
    _ = conn.WriteJSON(v)
}

func optionsToFlags(opts map[string]string) []string {
    if len(opts) == 0 { return nil }
    keys := make([]string, 0, len(opts))
    for k := range opts { keys = append(keys, k) }
    sort.Strings(keys)
    out := make([]string, 0, len(keys))
    for _, k := range keys {
        v := opts[k]
        k = strings.TrimSpace(k)
        if k == "" { continue }
        if v == "" { out = append(out, "--"+k); continue }
        out = append(out, fmt.Sprintf("--%s=%s", k, v))
    }
    return out
}

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

// spaFallbackFS serves index.html from disk for unknown routes (client-side routing support).
func spaFallbackFS(static http.Handler, indexPath string) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/ws/") {
            static.ServeHTTP(w, r)
            return
        }
        p := r.URL.Path
        if p == "/" || path.Ext(p) == "" {
            // Serve index.html from disk
            data, err := os.ReadFile(indexPath)
            if err != nil { http.NotFound(w, r); return }
            http.ServeContent(w, r, "index.html", time.Now(), bytes.NewReader(data))
            return
        }
        static.ServeHTTP(w, r)
    })
}

// spaFallbackEmbed serves index.html from the embedded dist/ for unknown routes.
func spaFallbackEmbed(static http.Handler, distFS fs.FS) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/ws/") {
            static.ServeHTTP(w, r)
            return
        }
        p := r.URL.Path
        if p == "/" || path.Ext(p) == "" {
            data, err := fs.ReadFile(distFS, "index.html")
            if err != nil { http.NotFound(w, r); return }
            http.ServeContent(w, r, "index.html", time.Now(), bytes.NewReader(data))
            return
        }
        static.ServeHTTP(w, r)
    })
}
