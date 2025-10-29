# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChessTerrain is a prototype chess analysis visualization tool that displays Stockfish engine analysis as a 3D terrain of hexagonal cylinders. The application consists of three main components:

1. **Stockfish engine** (`sf/`) - C++ chess engine binary
2. **Go server** (`srv/`) - WebSocket server that interfaces with Stockfish
3. **JavaScript client** (`js/`) - Three.js-based 3D visualization using Vite

## Build and Development Commands

### Stockfish Engine

```bash
# Build Stockfish (one-time setup)
cd sf/Stockfish-master/src
make profile-build ARCH=x86-64        # For Intel
# or
make profile-build ARCH=apple-silicon # For Apple Silicon

# Move binary to expected location
mv stockfish ../..
```

The binary should be at `sf/stockfish` (referenced by the Go server).

### Go Server

```bash
cd srv

# Build the server
go build

# Run in production mode (serves prebuilt dist/)
./srv --serve-static fs

# Run in development mode (with Vite)
./srv --allowed-origin http://localhost:5173

# Run tests
go test -v
```

The server expects Stockfish at `../sf/stockfish` by default. Use `--cmd` flag to override.

### JavaScript Client

```bash
cd js/src

# Install dependencies (one-time setup)
npm install

# Development mode (with hot reload)
npx vite
# Visit http://localhost:5173

# Build for production
npx vite build
# Manually copy dist/ to ../srv/
```

## Architecture

### Communication Flow

```
Browser (Three.js) → WebSocket → Go Server → Stockfish (UCI protocol)
                                     ↓
                              Streams stdout/stderr
                              Accepts stdin commands
```

### Key Components

**Go Server (`srv/server.go`)**
- WebSocket endpoint at `/ws/run` that spawns Stockfish process
- Streams engine output back to client in real-time
- Accepts UCI commands from client via WebSocket messages
- Message types: `started`, `stdout`, `stderr`, `exit`, `error`, `pong`
- Client message types: `stdin`, `signal`, `ping`

**JavaScript Modules**
- `main.js` - Three.js scene setup, hexagonal cylinder terrain rendering
- `comms.js` - ServerConnection class handling WebSocket communication
- `worker.js` - Web Worker for async WebSocket handling
- `board.js` - cm-chessboard integration, Chess.js for move validation
- `utils.js` - Helper functions and debugging utilities

**Hexagonal Coordinate System**
- Uses axial coordinates [q, r] with derived s
- See https://www.redblobgames.com/grids/hexagons/
- Hexcyls grow/shrink based on Stockfish centipawn evaluation
- Height scales from 5% to 245% of neutral height (3.0 units)

### State Management

- Current position stored as FEN string in `main.js`
- Chess.js library validates moves and maintains game state
- Chessboard updates trigger terrain regeneration
- Server maintains no game state (stateless command processor)

### Development vs Production Modes

**Development:**
- Run Vite dev server on `:5173`
- Run Go server with `--allowed-origin http://localhost:5173`
- Server only exposes `/api` and `/ws` endpoints
- Vite provides hot module reload

**Production:**
- Build JS with `npx vite build` → `dist/`
- Copy `dist/` to `srv/`
- Run server with `--serve-static fs`
- Server serves static files and handles WebSocket

## Important File Paths

- Stockfish binary: `sf/stockfish`
- Server binary: `srv/srv`
- Production static files: `srv/dist/`
- Entry point: `js/index.html` (Vite serves from `js/`)

## Known Issues and Design Notes

- Communication with server is intentionally slow for debugging (see README status notes)
- Server must be manually killed or it continues analyzing (CPU intensive)
- No automatic reconnection on server failure (requires page refresh)
- Code quality is prototype-level; pulled from examples and AI-generated code
- This is the author's first significant JavaScript program
