# ct

## Overview

This chess analysis application runs in a web page and makes requests to a localhost-only server. It runs a chess engine and displays the analysis produced by the engine using 3-D graphics. Since chess engines consume arbitrary amount of CPU, it's unlikely this app will ever be offered as a hosted service. It would be expensive to run the engine so I would need to figure out a way to take money which I don't want to do.

## Status

"Beta" quality. Since I had a stroke in October 2025 and can basically no longer type, most of the coding has been done by Claude code.

## Building and Running

The prototype has three major components, each written in a different programming language.
To build and run the prototype, you need the correct tooling for each.

### Stockfish chess engine (the "engine")

Stockfish is written in C++. I've built it on Intel Mac using clang. Stockfish is designed
for portability and "should" compile cleanly on every major architecture using the leading
C++ compiler for that architecture. I'm uncertain about MSVC and Windows.

### Local server (the "server")

The server is written in Golang. It was vibe-coded by ChatGPT5. You'll need the Go compiler
v1.24 or later for your platform.

### Front end (the "client")

The repo contains a copy of a recent Javascript build artifact,
so you don't need to build the Javascript. The copy is located in the `srv` (server) directory, `srv/dist`. The instructions below direct
you to run the server to serve this prebuilt distribution. Separate
instructions describing how to develop and build the Javascript are
provided later.

### Specifics

1. Pull the repo and open a command line tool in the repo's top level directory,
`<repo-path>/ct`.

1. `cd sf/Stockfish-master/src` and `make`. This will give examples of the required platform-specific command line. There are many supported architectures. **There's no need to optimize.** I recommend using `ARCH=x86-64` or `ARCH=apple-silicon` as appropriate, e.g. `make -j profile-build ARCH=apple-silicon`.  If you have issues building Stockfish for your platform, please let me know.

1. Move the generated binary up a couple of directories: `mv stockfish ../..`, so the
binary should be called `<repo-path>/ct/sf/stockfish`.

1. Change directories to the `srv/` top level directory in the repo. Enter this command
to run Stockfish: `../sf/stockfish`. It should respond with a line like this:
`Stockfish dev-20250819-4754edd1 by the Stockfish developers (see AUTHORS file)`

1. Type `uci<enter>`. Stockfish should respond with a list of option settings and end
with `uciok`. That's it for now. Use ^D to shut down Stockfish.

1. Continuing in the `srv/` directory, `go build`. This should create the binary, `srv/srv`.

1. Run the binary: `./srv --serve-static fs`. It should respond:
`202X/MM/DD HH:MM:SS Starting server on :8080 (serveStatic=fs, allowedOrigin="", cmd="../sf/stockfish")` and then `Serving static files from disk: dist`.


1. Open a browser and visit `http://localhost:8080`. You should see a gray background with a small chessboard at upper left. The status bar at the bottom should say **server status: running**. 

1. **Please don't be too quick with the buttons.** Allow a few seconds fot the app to start before clicking.


## Usage

You should be looking at a page with a gray canvas and darker gray command and status bars at top and bottom. The top bar should contain a text box populated with a string and there should be button labeled **Go**.
The bottom bar should contain the message `server status: running`. There should be a small chessboard at upper left.

The string in the text box is a [**FEN**](https://en.wikipedia.org/wiki/Forsyth%E2%80%93Edwards_Notation). In particular, it matches the chessboard: it's the starting position.

Click **Go**.

You should see some hexagonal cylinders "grow" into position on the canvas. I call these hexcyls. They display the engine's analysis of the best moves from the starting position, which is represented by the center. You can use the mouse to reorient the terrain display. Please be patient with user interactions; server communication is intentionally very slow to simplify debugging. It can easily be made faster and will be in the future.

Now click on a "live" hexcyl (not the center one). The chessboard and FEN should display the move. The new "center" hexcyl's unoccupied neighbors rise to display the best moves of this new position. These hexcyls are not as tall, are red instead of green, and are labeled in black text instead of white text. They are Black's best responses to White's move, and White has the small advantage of having moved first.

Make a move on the chessboard that is not one of the moves recommended by the engine (for example, try moving the king, or an edge pawn). Again, everything else should update. Do this a few times. Finally, click Go again. Clicking Go clears the canvas and restarts analysis with the FEN as the center hexcyl.

**Important note:** when you're done with ChessTerrain, be sure and kill the server. This should kill Stockfish. If you don't, it will continue analyzing, which uses significant CPU and will quickly drain the battery on your laptop. In the future, the server will be more sensitive to loss of client connection and will include a configurable timeout.

I'm curious for feedback on the display.

### PGN playback

When you get tired, click the PGN button. If you have a PGN file you can select it and it will play back slowly allowing about four seconds per move.It will not accept user input on the surface during playback.

## Developing and building the Javascript

1. Ensure you have installed up-to-date versions of node, npm, npx, and vite.

1. Open a command line window and cd to `<repo-path>/ct/js/src`.

1. Type `npm install`. It should install about 61 packages. It may complain about security vulnerabilities. If you're concerned, you can type `npm audit` to see the issue and `npm audit fix` to update with a fix.

1. Run: `npx vite`. You should see something like `VITE v7.1.12  ready in 198 ms` and below that, some lines including: `➜  Local:   http://localhost:5173/`.

1. For development purposes, you should delete the `dist/` directory in the `srv/` directory and run the server like this: `./srv --allowed-origin http://localhost:5173` (note that `--serve-static` is not present in the command line).

1. Visit `http://localhost:5173` and the app should appear.

1. To rebuild the `dist`, if desired: `npx vite build`. Manually move the dist to `../srv`.



