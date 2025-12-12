// Contains the ServerConnection class
import * as utils from "./utils.js";

const COMMDB_NONE = 0;
const COMMDB_LOW = 1;
const COMMDB_MED = 2;
const COMMDB_ALL = 3;

let commDebugLevel = COMMDB_LOW;

function commdbg(level, msg) {
  if (commDebugLevel >= level) {
    utils.dbg(msg);
  }
}

function commdbobj(obj) {
  if (commDebugLevel > level) {
    utils.dbobj(obj);
  }
}

// One instance of private class MessageQueue is used per ServerConnection
// to hold messages outbound to the chess server (Stockfish)
class MessageQueue {
    constructor() {
        this.queue = [];
    }

    enqueue(message) {
        if (typeof message !== 'string') {
            console.warn("Only string messages are supported.");
            return;
        }
        this.queue.push(message);
    }

    dequeue() {
        if (this.isEmpty()) {
            return undefined;
        }
        return this.queue.shift();
    }

    peek() {
        if (this.isEmpty()) {
            return undefined;
        }
        return this.queue[0];
    }

    isEmpty() {
        return this.queue.length === 0;
    }

    size() {
        return this.queue.length;
    }
}

// The commState is mostly to handle initialization (connection).
// We also display it to users in the status bar.
// The DEAD state is not recoverable; you have to refresh the page if
// the server dies. Making it recoverable would require this front end
// to maintain and save the game state, so it's much more work.
// Note: weirdly, Javascript does not allow class-local constants.

const STATE_START = "not started";
const STATE_OPENING = "connecting";
const STATE_CONNECTED = "running";
const STATE_DEAD = "dead (refresh required)";

// The web worker handles the link to the server that fronts Stockfish.
// The updater is a callback function to update the display on info messages.
// Web workers each get their own "global" scope, so the entire question
// of loading as a traditional script versus ES6 module doesn't even apply.
// Which is fortunate, because the worker.onmessage can't be contained in
// a class either ... Javascript is weird.

export class ServerConnection {
    constructor(updateFunc) {
        this.updater = updateFunc;
        this.outbound = new MessageQueue();
        this.commState = STATE_START;
        this.worker = new Worker(new URL("./worker.js", import.meta.url), {
            type: "module"
        });
        this.worker.onmessage = (e) => {
            this.handleMessage(e.data);
        };
    }

    setStatus() {
        if (this.commState === null || this.commState === undefined) return;
        msgtext.innerText = "server status: " + this.commState;
    }

    // Parse UCI responses from Stockfish
    // https://official-stockfish.github.io/docs/stockfish-wiki/UCI-&-Commands.html
    // https://backscattering.de/chess/uci/
    parseResponse(fromServer) {
        const line = fromServer.data;
        const words = line.split(" ");
        switch (words[0]) {
        case "uciok":
            commdbg(COMMDB_ALL, `parseResponse(${line})`);
            // Sent at the end of id and options in response to "uci". Init is complete.
            this.outbound.enqueue("setoption name MultiPV value 6");
            this.outbound.enqueue("setoption name UCI_ShowWDL value true");
            this.outbound.enqueue("ucinewgame");
            this.outbound.enqueue("isready");
            break;
        case "id":
            commdbg(COMMDB_ALL, `parseResponse(${line})`);
            // next word "name" or "author"; we care about "name Stockfish"
            if (words[1] == "name") {
                if (words[2] != "Stockfish") {
                    alert(`This program is designed to work with Stockfish.\n` +
                          `Execution continues, but ${words[2]} might not work correctly.`);
                }
            }
            break;
        case "option":
            commdbg(COMMDB_ALL, `parseResponse(${line})`);
            // We care about option name MultiPV type spin default 1 min 1 max 256 type:stdout])
            // And option name UCI_ShowWDL type check default false type:stdout])
            // For now that's it; in the future, Threads, Ponder, and possibly others.
            break;
        case "readyok":
            commdbg(COMMDB_ALL, `parseResponse(${line})`);
            // For now we don't need to anything if the engine says it's ready - we
            // just send commands and count on typeahead into the pipe from the server
            // to the chess CLI to hold commands until the server is ready.
            break;
        case "info":
        {
            let index = 0;
            let value = 0.0;
            let name = "?";
            let nameIndex = words.length;

            // An info line from Stockfish can look like this, with just one move on the preferred variation (pv):
            // info depth 3 seldepth 4 multipv 1 score cp 38 nodes 347 nps 347000 hashfull 0 tbhits 0 time 1 pv c2c4
            // If the UCI_ShowWDL option is true (we set it), there are more fields. We don't currently use these.
            //
            // Later in analysis, an info line can end like this:
            // [ ... ] time 11 pv e2e4 c7c5 g1f3 b8c6 b1c3 e7e6 d2d4 c5d4 f3d4 g8f6 d4b5 d7d5 e4d5 e6d5
            // There are now many more moves on the preferred variation starting with ("named") e2e4.
            // These moves never come with evaluations, so they are useless to us.
            // Note: the "cp" field stands for "centipawns", the position evaluation in hundreths of a pawn.

            if (words.length < 8) {
                // short info line like "info depth 27 currmove h2h3 currmovenumber 6" not used right now
                break;
            }
            commdbg(COMMDB_ALL, `parseResponse(${line})`);
            for (let i = 0; i < words.length; i++) {
                let word = words[i];
                if (word == "multipv") {
                    index = +words[i+1];
                } else if (word == "cp") {
                    value = +words[i+1] / 100.0;
                } else if (word == "pv") {
                    nameIndex = i+1;
                    name = words[nameIndex];
                }
            }
            this.updater(index, value, name);
            break;
        }
        default:
            commdbg(COMMDB_ALL, `response ignored: ${fromServer}`);
            break;
        }
    }

    handleMessage(msg) {
        switch (msg.type) {
        case "opened":
            // WebSocket successfully opened - transition to connected and flush queue
            if (this.commState == STATE_OPENING) {
                this.commState = STATE_CONNECTED;
                commdbg(COMMDB_LOW, "WebSocket opened, flushing message queue");
                this.flushQueue();
            } else {
                commdbg(COMMDB_LOW, "unexpected OPENED message from worker ignored");
            }
            break;
        case "started":
            // Stockfish process started - send initial UCI command
            if (this.commState == STATE_CONNECTED) {
                this.outbound.enqueue("uci");
                this.trySend();
            } else {
                commdbg(COMMDB_LOW, "unexpected STARTED message from server ignored");
            }
            break;
        case "error":
            commdbg(COMMDB_LOW, `error from server: ${msg.error}`);
            if (this.commState == STATE_CONNECTED) {
                // Connection errors will trigger worker retry, but if we're connected
                // and get an error from the server itself, that's fatal
                if (msg.error && !msg.error.includes("WebSocket")) {
                    this.commState = STATE_DEAD;
                }
            }
            break;
        case "fatal_disconnect":
            commdbg(COMMDB_LOW, `fatal disconnect: ${msg.message}`);
            this.commState = STATE_DEAD;
            this.setStatus();
            alert(msg.message || "Server connection was lost. You must refresh the page.");
            break;
        case "stdout":
            this.parseResponse(msg);
            break;
        case "stderr":
            commdbg(COMMDB_LOW, `stderr from chess server: ${msg.data}`);
            break;
        case "debug":
            commdbg(COMMDB_LOW, `debug: ${msg.data}`);
            break;
        default: // pong, exit, truly unknown
            commdbg(COMMDB_MED, `onmessage(${msg.type}: ${msg.data} (${msg.status})) ignored`);
            break;
        }

        this.setStatus();
    }

    // Send all queued messages if connected
    trySend() {
        while (this.commState === STATE_CONNECTED && !this.outbound.isEmpty()) {
            const msg = this.outbound.dequeue();
            commdbg(COMMDB_ALL, `sending: "${msg}"`);
            this.worker.postMessage({ type: "stdin", data: msg });
        }
    }

    // Alias for trySend() - used when connection first opens
    flushQueue() {
        this.trySend();
    }

    startEngine(fen) {
        this.outbound.enqueue("stop");
        this.outbound.enqueue("isready");
        this.outbound.enqueue("ucinewgame");
        this.outbound.enqueue("isready");
        this.outbound.enqueue("position fen " + fen);
        this.outbound.enqueue("go infinite");
        this.trySend(); // Send immediately if connected
    }

    stop() {
        this.outbound.enqueue("stop");
        this.outbound.enqueue("isready");
        this.trySend(); // Send immediately if connected
    }

    // TODO for a major efficiency optimization, reduce
    // MultiPV to something that matches that actual number
    // of threads, rather than leaving it at 6. This can be
    // done as an option to "go" rather than a setoption.
    move(fen) {
        this.outbound.enqueue("position fen " + fen);
        this.outbound.enqueue("go infinite");
        this.trySend(); // Send immediately if connected
    }

    start() {
        commdbg(COMMDB_LOW, "start()");
        // Initiate connection immediately (worker will retry on failure)
        this.commState = STATE_OPENING;
        this.worker.postMessage({ type: "open", baseUrl: "http://localhost:8080" });
        this.setStatus();
    }
}

