// worker.js
// Usage from main thread:
//   const worker = new Worker("worker.js");
//   worker.onmessage = (e) => {
//       console.log("Message from worker:", e.data);
//   };
//   worker.postMessage({ type: "open", baseUrl: "http://localhost:8080" });
//   worker.postMessage({ type: "stdin", data: "sent to server" });
//
// Message types posted by this worker:
//   { type: "debug" data: "some debug message" }
//   { type: "error", error: "some error discovered locally" }
// And the types expected from the server that are passed through:
//   { type: "error", error: "some error discovered by the server" }
//   { type: "started", pid: Number, cmd: "commandPath" }
//   { type: "stdout", data: "a line of UCI response" }
//   { type: "stderr", data: "a line of something from stderr" }
//   { type: "pong", ts: Number } // number is a timestamp
//   { type: "exit", [optional] error: "message", [optional] exitCode: Number }
//
// In addition, all messages posted by this worker aside debug messages
// should contain a "status" field: status: statusString(ws) which correctly
// handles a possible null ws.
//
// Web workers each get their own "global" scope, so the entire question
// of loading as a traditional script versus ES6 module doesn't even apply.

let ws = null;
let baseUrl = "";

// Post a debug message back to the main thread
function dbg(msg) {
  postMessage({ type: "debug", data: msg });
}

// Post an error back to the main thread.
function error(msg) {
  postMessage({ type: "error", error: msg, status: statusString(ws) });
}

function statusString(ws) {
  // These strings are displayed directly to users
  // The state called "closed" is better described as "down"
  const names = ["connecting", "ready", "closing", "down"];
  return ws ? names[ws.readyState] : "down";
}

// Handle a message posted to this worker's pump.
onmessage = async (e) => {
  const msg = e.data;

  switch (msg.type) {
    case "open":
      dbg("open");
      baseUrl = msg.baseUrl || "";
      try {
        // Check health
        const resp = await fetch(baseUrl + "/api/health");
        if (!resp.ok) {
          error("/api/health returned " + resp.status);
          break;
        }
        const data = await resp.json();
        if (!data.ok) {
          error("/api/health response not ok");
          break;
        }
        dbg("health check OK");

        // Open websocket
        const wsUrl = baseUrl.replace(/^http/, "ws") + "/ws/run";
        ws = new WebSocket(wsUrl);
        dbg("web socket created");

        ws.onmessage = (event) => {
          try {
            const recv = JSON.parse(event.data);
            // forward all fields from server, adding current status
            const out = Object.assign({}, recv, { status: statusString(ws) });
            postMessage(out);
          } catch (err) {
            error("invalid JSON from server");
          }
        };

        ws.onerror = (err) => {
          error(
            "WebSocket error: " +
              (err && err.message ? err.message : String(err))
          );
        };

        ws.onclose = (e) => {
          error(
            "WebSocket closed: code " +
              (e.code || "unknown") +
              " reason " +
              (e.reason || "")
          );
        };
      } catch (err) {
        error(err.message);
      }
      break;

    case "stdin":
      if (ws && ws.readyState === WebSocket.OPEN) {
        let content = JSON.stringify({ type: "stdin", data: msg.data });
        dbg("sending to server: " + content);
        ws.send(content);
      } else {
        postMessage({
          type: "error",
          error: "not connected",
          status: statusString(ws),
        });
      }
      break;

    default:
      postMessage({
        type: "error",
        error: "Unknown message type",
        status: statusString(ws),
      });
      break;
  }
};
