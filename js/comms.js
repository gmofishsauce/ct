// The web worker handles the link to the server that fronts Stockfish.
// The updater is a callback function to update the display on info messages.

const worker = new Worker(new URL("worker.js", import.meta.url));
let updater = null;

function dbg(msg) {
    console.log(msg);
}

// The server status actually comes from the server. If the server encounters
// a serious error, it will send a message indicating it's died. But if the
// connection drops, the client may not do the right thing. XXX TODO
let serverStatus = "down";

function setStatus(msg) {
    if (msg === null || msg === undefined) return;
    serverStatus = msg;
    msgtext.innerText = "server status: " + serverStatus;
}

// Message queue - used for outbound commands to Stockfish.
export class MessageQueue {
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
// We don't display it to users - we only display the simpler serverState.
// The DEAD state is not recoverable; you have to refresh the page if the
// server dies. Making it recoverable would require this front end to
// maintain and save the game state, so it's much more work.

const STATE_START = "uninitialized";
const STATE_OPENING = "opening";
const STATE_CONNECTED = "connected";
const STATE_DEAD = "dead";

let commState = STATE_START;

// Network input side. Only communicates with the output side by enqueuing
// data to be sent and changing state variables. The argument is typed
// object from the web worker, not a network message. N.B. timeouts are all
// sort of "weird" numbers to make it less likely we'll fall into lockstep
// with other system activities.

const outbound = new MessageQueue();

// Parse UCI responses from Stockfish
// https://official-stockfish.github.io/docs/stockfish-wiki/UCI-&-Commands.html
// https://backscattering.de/chess/uci/
function parseResponse(fromServer) {
    const words = fromServer.split(" ");
    switch (words[0]) {
    case "uciok":
        dbg(`parseResponse(${fromServer})`);
        // Sent at the end of id and options in response to "uci". Init is complete.
        outbound.enqueue("setoption name MultiPV value 6\n");
        outbound.enqueue("setoption name UCI_ShowWDL value true\n");
        outbound.enqueue("ucinewgame\n");
        outbound.enqueue("isready\n");
        break;
    case "id":
        dbg(`parseResponse(${fromServer})`);
        // next word "name" or "author"; we care about "name Stockfish"
        if (words[1] == "name") {
            if (words[2] != "Stockfish") {
                alert(`This program is designed to work with Stockfish.\n` +
                      `Execution continues, but ${words[2]} might not work correctly.`);
            }
        }
        break;
    case "option":
        dbg(`parseResponse(${fromServer})`);
        // We care about option name MultiPV type spin default 1 min 1 max 256 type:stdout])
        // And option name UCI_ShowWDL type check default false type:stdout])
        // For now that's it; in the future, Threads, Ponder, and possibly others.
        break;
    case "readyok":
        dbg(`parseResponse(${fromServer})`);
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
        let restOfLine = [];

        // An info line from Stockfish can look like this, with just one move on the preferred variation (pv):
        // info depth 3 seldepth 4 multipv 1 score cp 38 nodes 347 nps 347000 hashfull 0 tbhits 0 time 1 pv c2c4
        // If the UCI_ShowWDL option is true (we set it), there are more fields. We don't currently use these.
        //
        // Later in analysis, an info line can end like this:
        // [ ... ] time 11 pv e2e4 c7c5 g1f3 b8c6 b1c3 e7e6 d2d4 c5d4 f3d4 g8f6 d4b5 d7d5 e4d5 e6d5
        // There are now many more moves on the preferred variation starting with ("named") e2e4.
        // These additional moves, if any, are passed to the display update function in restOfLine.

        if (words.length < 8) {
            // short info line like "info depth 27 currmove h2h3 currmovenumber 6" not used right now
            break;
        }
        dbg(`parseResponse(${fromServer})`);
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
        if (words.length > 1+nameIndex) {
            restOfLine = words.slice(1+nameIndex);   
        }
        updater(index, value, name, restOfLine);
        break;
    }
    default:
        dbg("response ignored");
        break;
    }
}

// Handle messages from worker thread - connect and then give "stdout" to parser.

worker.onmessage = (e) => {
    const msg = e.data;

    switch (msg.type) {
    case "started":
        if (commState == STATE_OPENING) {
            commState = STATE_CONNECTED;
            outbound.enqueue("uci\n");
        } else {
            dbg("unexpected STARTED message from server ignored");
        }
        break;
    case "error":
        dbg(`error from server: ${msg.error}`);
        if (commState == STATE_OPENING) {
            // do nothing; the transmit side will try again soon.
        } else if (commState == STATE_CONNECTED) {
            commState = STATE_DEAD;
        }
        break;
    case "stdout":
        parseResponse(msg.data);
        break;
    case "stderr":
        dbg(`stderr from Stockfish: ${msg.data}`);
        break;
    case "debug":
        dbg(`debug: ${msg.data}`);
        break;
    default: // pong, exit, truly unknown
        dbg(`onmessage(${msg.type}: ${msg.data} (${msg.status})) ignored`);
        break;
    }

    setStatus(msg.status);
};

export function startEngine(cmd) {
    outbound.enqueue("stop\n");
    outbound.enqueue("isready\n");
    outbound.enqueue("ucinewgame\n");
    outbound.enqueue("isready\n");
    outbound.enqueue("position " + cmd + "\n");
    outbound.enqueue("go infinite\n");
}

function doNet() {
    let delay = 537;
    switch (commState) {
        case STATE_START:
            // Ask the worker to open the connection and give it a couple of seconds.
            worker.postMessage({ type: "open", baseUrl: "http://localhost:8080" });
            commState = STATE_OPENING;
            delay = 1917;
            break;
        case STATE_OPENING:
            // It's been a couple of seconds and the connection has not opened.
            // Come back here pretty soon and try again. There's a race here where
            // if the connection completes during the short time window we're back
            // in the START state, the worker will create a second connection. I
            // should fix this.
            commState = STATE_START;
            delay = 3;
            break;
        case STATE_CONNECTED:
            // Normal state. If there's a message to Stockfish, send it.
            if (!outbound.isEmpty()) {
                worker.postMessage({ type: "stdin", data: outbound.dequeue() });
            }
            break;
        case STATE_DEAD:
            // There's no way out of the DEAD state except a page refresh.
            delay = 30*1000*1000;
            break;
        default:
            dbg(`unknown commState ${commState}`);
            break;
    }

    setTimeout(doNet, delay);
}

export function start(updateFunction) {
    updater = updateFunction;
    setTimeout(doNet, 1453);
}

