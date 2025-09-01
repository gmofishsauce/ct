// worker.js
// Usage from main thread:
//   const worker = new Worker("worker.js");
//   worker.onmessage = (e) => {
//       console.log("Message from worker:", e.data);
//   };
//   worker.postMessage({ type: "init", baseUrl: "http://localhost:8080" });
//   worker.postMessage({ type: "stdin", data: "hello\\n" });
//
// Worker messages back:
//   { type: "ready" }                 // after successful init
//   { type: "stdout", data: "..." }   // when server sends stdout
//   { type: "error", error: "..." }   // if something goes wrong

let ws = null;
let baseUrl = "";

function dbg(msg) {
  postMessage({type: "debug", data: msg});
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Delay for a little while (cheesy backoff) and then post
// an error back to the main thread.
function error(msg) {
  delay(2500);
  postMessage({ type: "error", error: msg });
}

// Delay for a little while (cheesy backoff) and then throw
// an error with the given message.
function fail(msg) {
  delay(2500);
  throw new Error(msg);
}

onmessage = async (e) => {
  const msg = e.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case "open":
      dbg("open");
      baseUrl = msg.baseUrl || "";
      try {
        // Check health
        const resp = await fetch(baseUrl + "/api/health");
        if (!resp.ok) {
          fail("/api/health returned " + resp.status);
        }
        const data = await resp.json();
        if (!data.ok) {
          fail("/api/health response not ok");
        }
        dbg("health check OK");

        // Open websocket
        const wsUrl = baseUrl.replace(/^http/, "ws") + "/ws/run";
        ws = new WebSocket(wsUrl);
        dbg("web socket created");

        ws.onmessage = (event) => {
          try {
            const recv = JSON.parse(event.data);
            postMessage({type: recv.type, data: recv.data});
          } catch (err) {
            error("invalid JSON from server");
          }
        };

        ws.onerror = (err) => {
          error("WebSocket error");
        };

        ws.onclose = () => {
          error("WebSocket closed");
        };
      } catch (err) {
        error(err.message);
      }
      break;

    case "stdin":
      postMessage({type: "debug", data: "stdin case entered"});
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "stdin", data: msg.data }));
      } else {
        postMessage({ type: "error", error: "WebSocket not open" });
      }
      break;

    default:
      postMessage({ type: "error", error: "Unknown message type" });
      break;
  }
};

