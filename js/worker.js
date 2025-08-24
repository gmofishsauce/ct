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

onmessage = async (e) => {
  const msg = e.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case "init":
      postMessage({type: "debug", data: "worker init"});
      baseUrl = msg.baseUrl || "";
      try {
        // Check health
        const resp = await fetch(baseUrl + "/api/health");
        if (!resp.ok) throw new Error("/api/health returned " + resp.status);
        const data = await resp.json();
        if (!data.ok) throw new Error("/api/health response not ok");
        postMessage({type: "debug", data: "health check OK"});

        // Open websocket
        const wsUrl = baseUrl.replace(/^http/, "ws") + "/ws/run";
        ws = new WebSocket(wsUrl);
        postMessage({type: "debug", data: "web socket created"});

        ws.onmessage = (event) => {
          try {
            //postMessage({type: "debug", data: JSON.stringify(event.data)});
            const recv = JSON.parse(event.data);
            postMessage({type: recv.type, data: recv.data});
          } catch (err) {
            postMessage({ type: "error", error: "invalid JSON from server" });
          }
        };

        ws.onerror = (err) => {
          postMessage({ type: "error", error: "WebSocket error" });
        };

        ws.onclose = () => {
          postMessage({ type: "error", error: "WebSocket closed" });
        };
      } catch (err) {
        postMessage({ type: "error", error: err.message });
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

