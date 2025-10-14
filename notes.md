Notes written hand before 10/7/2025

```
Pull app together:

DONE App needs a text box with a button next to it and a status bar.
Startup:
    DONE send fixed initialization to server.
DONE If not responding:
    DONE message in status bar, button says "start", text box gray.
LATER (text UI is adequate for now): When server connection:
    pale "startpos" message in status bar, button says "Go!".
    click button -> startpos to server
    FEN into text box, click button -> FEN to server
Running (for now)
    arrow keys move between hexes
    enter/return centers on the selected hex
    there is no "blowout" to more hexes yet.

Initially set MultiPV = 6

Right click on center object: no action - it's dead.
Right click on hex at distance 1 from center:
    three menu items: "Expand Left", "Expand Right", and "Center"
    At distance 2, on any of the 12 possible nodes, you just get "Center".
Hexes at distance > 2 freeze (color = light blue) at last recorded vertical scale.

Implementation
Better put the vertical scale factors on the objects first.
Then, put the object's {q, r} on the object.

Not clear
Can I put ALL the indexing stuff on the objects and just have a "sea of objects"
OR do I need to access objects by some kind of index.

Ah - I only need to access hexcyls by index when updating from Stockfish.
So each running Stockfish instance needs to know its "zero" object,
    and the objects indexed by its traces have to be "contiguous".

So, ah ah - An unordered sea of hexcyls with an ordered array of hexcyls
    references (indices? pointers? what?) used at Stockfish update time.

Bottom line:
DONE Finish basic mouse selection ("demo")
DONE Put actual and target scales on the objects
???? Move existing demo to a sea of objects with one mapping array
???? Add a second Stockfish instance and make sure nothing breaks
???? Change the mapping arrays to be associated with the Stockfish instances


More about the model (9/23/2025):
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
DONE I need to put {q, r} on the nameless objects returned by makeCylWithLabel().
Reduce initial display to just the center cylinder.
Add a function requireHexcyl(...) that either makes a new hexcyl at {q, r}
    or returns the existing hexcyl.
???? There will be one primary server (MultiPV = 6) and N secondaries (MultiPV = 3)
???? N will be a parameter with a default value, eventually a "Settings..." button
???? [ side note: mouse over hexcyl => put FEN in text box "for real" ]
???? [ side note: try showing just the centered node on the chessboard ]
???? clicking on centered node does nothing
???? single click on non-centered node starts a secondary centered on that node
???? double click on non-centered node centers that node, freezing some node(s).

Simplification:
There is just one kind of click, "expand"
It recenters the server and expands into all unused adjacent hexes, usually 3.
All the other hexcyls become abandoned (need visual indication).
I still need requireHexcyl() based on the exposed (q, r) coordinates as above.
When hexcyl click:
    clear the "active" (array of active hexcyl references)
    stop the engine
    iterator neighbors of selected hexcyl:
        if doesn't exist:
            create and add to "active"
    reorder active so that the 1-line is northeast-most, etc.
    start the engine with MultiPV = len(active)
when "Go" click:
    All of hexcyl click but ALSO clean the "ocean" (and remove all from scene)

? All hexcyls (aside "Start") are created by requireHexcyl from updateView().
? Created hexcyls are always added to both the ocean[] and active[].

CORRECTION: the "ocean" will never be cleared of hexcyls, but hexcyls can
be removed from the scene with scene.remove(). All hexcyls ever created will
exist until program (page) termination. All hexcyls will be created by
requireHexcyl(), which will first check the ocean[] for unused elements
and "repurpose" them if they exist. In practice hexcyls are only removed
from the scene when they are all removed, at which point all the hexcyls
will be removed from the scene and serially reallocated as the scene refills.
```

# START OF AI REVIEW

Notes from GPT-5 mini on 10/7/2025:


```
GitHub Copilot

Thanks — I reviewed the attached main.js and will review comms.js, utils.js and worker.js as well if you want (I can open them and give line-level suggestions). Below are concise findings and recommended fixes.

Summary (quick)
- main.js: generally OK architecturally (dynamic registry, active/frozen states, PickHelper use) but has a few bugs and some fragile patterns.
- comms.js: likely UCI-parsing and API consistency issues (based on earlier conversation); watch for fragile string parsing, missing restart helper, and inconsistent method names (startEngine vs move).
- utils.js: check PickHelper return shape; small bugs reported earlier (dbobj logging, makeColor sign, toHex clamping) may still be present.
- worker.js: ensure it forwards full parsed messages, and improves websocket error/close diagnostics.

Main.js — issues found (with concrete fixes)
1) result.parent is used but should be result.group.parent
- Location: requireHexcylAt() state check:
  - Bug: `if (result.parent == null)` — result (the custom object) has no parent property; you meant the Three.js group.
  - Effect: the test always treats the object as not in scene, leading to incorrect state transitions (missing checks for items already in scene).

Fix (replace that one line). I can apply this for you; suggested patch:

````javascript
// ...existing code...
    if (result.group.parent == null) {
      // state (3) => (1)
      scene.add(result.group);
      makeActive(result);
      dbg(`STATE ${keyFor(result.qrVec)} (3)=>(1)`);
    } else {
      // state (1) => (2)
      // Click handler should have cleared activeKeys
      // TODO visual indication of "frozen" state
      dbg(`STATE ${keyFor(result.qrVec)} (1)=>(2)`);
    }
// ...existing code...
````

2) group.owner vs group.userData
- You set `group.owner = result;` in makeHexcyl and rely on PickHelper to return the nameless hexcyl object. Attaching custom fields on Object3D is fine, but best practice is to use `group.userData` (Three.js-sanctioned).
- Suggestion: migrate to `group.userData.owner = result` (or `userData.key`) to avoid conflicts and be explicit. If PickHelper expects `.owner` today, either update PickHelper or keep `.owner` plus add `userData` for safety.

3) PickHelper return shape — brittle
- The click handler depends on `pickHelper.pick(...)` returning the custom hexcyl object. If PickHelper instead returns an intersection (mesh) you may get incorrect behavior.
- Recommendation: make the click handler robust: accept either a hexcyl object or an intersection and walk up to `object.parent` to find `.owner` or `.userData.owner`.

4) activeKeys is an ordered array of hexcyl objects (OK but beware)
- You rely on activeKeys[0] being the logical center. That's fine, but consider renaming to activeStack or documenting the invariant.
- If you ever need O(1) membership tests, switch to a Set in addition to the array.

5) updateView index handling / basisVectors mapping
- updateView currently ignores indices outside 0..basisVectors.length-1. Make sure the engine's indices match this convention (engine may send pv indices starting at 1). Add a comment documenting the expected index mapping or normalize inbound index values.

6) currentFenWithMoves string manipulation
- You append moves to the text with naive string concatenation; validate that you don't repeatedly append moves on repeated clicks (you guard for " moves" substring, but it can still be error-prone). Consider building an explicit array of moves and formatting the UCI command when you call primaryServer.move(...).

7) hexcyls map never trimmed (intentional)
- This is by design (reclaim), but be mindful of potential growth in long sessions. If you want bounded memory, add a reuse / LRU strategy.

Other suggestions
- Replace `dbobj` with safer introspection (avoid using template ${obj} which yields [object Object]); use JSON.stringify(obj, null, 2) or print constructor name and keys.
- Consider moving label/update state onto group.userData (e.g., userData.label) rather than a separate result object — that will simplify PickHelper integration and serialization.

High-level checks to run in the other files (I can inspect them now)
- comms.js: verify the API methods used here exist (startEngine, move, stop) and that move performs a “soft restart” as expected. Make sure UCI parsing is robust (don't rely on fragile token positions).
- utils.js: ensure PickHelper.pick returns either the owner or a consistent intersection object; fix dbobj, makeColor, toHex if still buggy.
- worker.js: ensure you forward full parsed messages (don't drop fields), and improve onerror/onclose logging.

If you want, I can:
- apply the small main.js fix (result.group.parent) now,
- or open comms.js, utils.js and worker.js and give line-level issues and small fixes.

Which do you prefer?
```


```
GitHub Copilot

I reviewed comms.js and worker.js and prepared focused, low-risk fixes and recommendations. I still need utils.js contents (open it in the editor or paste it) to finish that file's review.

Summary — high level
- comms.js: mostly OK but has some small, real bugs and fragile parsing assumptions (unsafe indexing, bad string interpolation, minor UI status update issue). I show minimal fixes below.
- worker.js: good structure; add ws.onopen/close clarity, forward full server payloads (preserve fields) and include status everywhere; improve ws URL construction and JSON parse error reporting. Patch below.

Suggested patches (apply if you want). Each patch keeps changes minimal and safe.

1) comms.js — fixes
- Fix dbobj template literal (was literal text).
- Make setStatus robust if msgtext isn't defined.
- Make info parsing robust (bounds checks before reading words[i+1]).
- Improve default handleMessage logging to include JSON.stringify(msg) for clarity.

````javascript
// ...existing code...
function dbg(msg) {
    console.log(msg);
}

function dbobj(obj) {
    // show object keys and values (use JSON for clarity)
    dbg(`=== Properties of ${obj && obj.constructor ? obj.constructor.name : typeof obj}: ===`);
    try {
        console.log(JSON.stringify(obj, Object.keys(obj || {}), 2));
    } catch (err) {
        // fallback to iterating properties if not serializable
        for (let prop in obj) {
            console.log(`  ${prop}: ${obj[prop]}`);
        }
    }
}
// ...existing code...

    setStatus() {
        if (this.commState === null || this.commState === undefined) return;
        // msgtext may be a global element reference; fall back to DOM lookup if not present
        const el = (typeof msgtext !== 'undefined' && msgtext) ? msgtext : document.getElementById && document.getElementById('msgtext');
        if (el) {
            el.innerText = "server status: " + this.commState;
        } else {
            // nothing to update in DOM; still log for debugging
            dbg("server status: " + this.commState);
        }
    }
// ...existing code...

        case "info":
        {
            let index = 0;
            let value = 0.0;
            let name = "?";
            // guard against too-short lines
            if (words.length < 8) {
                break;
            }
            dbg(`parseResponse(${line})`);
            for (let i = 0; i < words.length; i++) {
                let word = words[i];
                const next = (i + 1) < words.length ? words[i + 1] : undefined;
                if (word == "multipv" && next !== undefined) {
                    index = +next;
                } else if (word == "cp" && next !== undefined) {
                    value = +next / 100.0;
                } else if (word == "pv" && next !== undefined) {
                    // pick the first move in pv as the named move
                    name = next;
                    // optionally we could capture the rest of the pv, but for now first move is fine
                }
            }
            this.updater(index, value, name);
            break;
        }
// ...existing code...

        default: // pong, exit, truly unknown
            dbg(`onmessage ignored: ${JSON.stringify(msg)}`);
            break;
// ...existing code...
````

Notes for comms.js
- parseResponse still assumes Stockfish-style token names; if you later support other engines or extended UCI output, consider tokenizing with a general scanner or regex and returning an object with parsed fields.
- Consider exposing restartWithMove(fen, move, multiPV) in this class later to centralize restart logic.

2) worker.js — fixes
- Add ws.onopen to notify main thread when the socket becomes ready.
- Use explicit https?→wss/ws replacement.
- Forward full parsed server object (Object.assign with status).
- Provide more detailed close/error messages and include raw payload when JSON parse fails.

````javascript
// ...existing code...
        // Open websocket
        const wsUrl = baseUrl.replace(/^https?/, (m) => (m === "https" ? "wss" : "ws")) + "/ws/run";
        ws = new WebSocket(wsUrl);
        dbg("web socket created");

        // notify when socket becomes open
        ws.onopen = () => {
          postMessage({ type: "started", data: "websocket open", status: statusString(ws) });
        };

        ws.onmessage = (event) => {
          try {
            const recv = JSON.parse(event.data);
            // forward all fields from server, adding current status
            const out = Object.assign({}, recv, { status: statusString(ws) });
            postMessage(out);
          } catch (err) {
            // include a truncated raw payload for debugging
            const raw = typeof event.data === "string" ? event.data.slice(0, 1024) : String(event.data);
            error("invalid JSON from server; raw payload (truncated): " + raw);
          }
        };

        ws.onerror = (errEvent) => {
          // errEvent is often an Event, not Error; stringify minimally
          const msg = errEvent && errEvent.message ? errEvent.message : (errEvent && errEvent.type ? errEvent.type : "WebSocket error");
          postMessage({ type: "error", error: "WebSocket error: " + msg, status: statusString(ws) });
        };

        ws.onclose = (e) => {
          // Distinguish closes from errors; include code/reason if present
          postMessage({ type: "closed", code: e && e.code ? e.code : null, reason: e && e.reason ? e.reason : null, status: statusString(ws) });
        };
// ...existing code...
````

Worker notes
- You may want to post a distinct "connected" or "ready" type rather than "started" for clarity (I used "started" in the example to mesh with existing comms.js handling).
- Consider rate-limiting oversized error payloads.

Next
- Paste/open utils.js in the editor or paste its contents here and I’ll run the same focused review and propose any fixes (esp. PickHelper.pick shape, dbobj, color helpers, toHex clamping, texture reuse).

Which do you want next: I can produce a git patch for these changes or apply further small refinements.
```

```
worker.js — quick review and suggestions

What’s good
- Clear, well-documented message contract between worker and main thread.
- Health check before opening the websocket.
- Incoming server JSON is parsed and forwarded; status is injected so UI always knows websocket state.
- stdin messages are serialized consistently.

Issues / improvements (concise)
- onopen handler is missing. Add ws.onopen to post a non-error "connected/ready" message so the UI can react immediately when the socket becomes open.
- onclose and onerror currently call error(...) which posts type: "error". Consider posting a distinct type for close (e.g., {type: "closed", code, reason, status}) so the main thread can distinguish normal closures from errors.
- statusString(ws) uses names[ws.readyState]; if ws.readyState is outside 0..3 (unlikely) this will return undefined. A safe fallback would be included.
- ws URL conversion baseUrl.replace(/^http/, "ws") works for http/https, but be explicit: prefer replace(/^https?/, "ws") so intent is clear.
- JSON from server: code trusts the server to produce expected fields. If server sends large objects or nested fields, you blindly forward them; consider validating recv.type and normalizing unexpected payloads to avoid confusing the main thread.
- onmessage JSON parse error: error("invalid JSON from server") posts with status but loses the original payload content (which might be useful for debugging). Consider including the raw string (or length) in the error message cautiously.
- Network error object handling in ws.onerror uses err.message, but many browsers pass an Event rather than Error; current code handles this tolerably. Still, using ws.addEventListener('error', e => ...) and including e.type or e.message (when present) could be clearer.
- Worker postMessage contract: you sometimes call postMessage(out) and sometimes postMessage({...}). Be consistent (always include type + status) so the main thread can rely on fields being present.
- If baseUrl is remote and fetch fails due to CORS, the error message will be the network error message; consider reporting more actionable advice.

Small concrete changes to consider
- Add ws.onopen and post a message like: postMessage({ type: "connected", status: statusString(ws) });
- Use a non-error message type for close: postMessage({ type: "closed", code: e.code, reason: e.reason, status: statusString(ws) });
- Make ws URL building explicit: const wsUrl = baseUrl.replace(/^https?/, (m) => (m === "https" ? "wss" : "ws")) + "/ws/run";
- Include raw payload in JSON parse error (with length/truncation): error("invalid JSON from server: " + String(event.data).slice(0,200));

Next: comms.js and utils.js
I don’t have the current contents for comms.js and utils.js in this message. Please either:

- Paste comms.js and utils.js contents here, or
- Confirm I can read them from the workspace (or run these commands locally and paste output):
  - cat comms.js
  - cat utils.js

Once I have those files I’ll do the same concise, line-level review and propose small, safe patches.
```

# END OF AI REVIEW

# Chessboard integration:

Step 1: Allow only valid FEN in text box, no "moves ..". When Go, validate FEN with chess.js,
clear text box if bad. Otherwise set FEN on chessboard and use as starting position. If "Go"
on empty text box, send "startpos".

When move on chessboard, ... ? Can I pass a new FEN to Stockfish without "ucinewgame" ... ?
Yes. So stop server, get new FEN, send to server, much like Hexcyl click. For a start, don't
fix Hexcyl click to drive the board (yet).

Step 2: when Hexcyl click, set the board, and then do the entire "move on chessboard" sequence.
