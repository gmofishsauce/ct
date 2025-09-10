import * as THREE from 'three';
import * as utils from './utils.js'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const canvas = document.querySelector( '#c' );
const renderer = new THREE.WebGLRenderer( { antialias: true, canvas } );
const scene = new THREE.Scene();
const baseHeight = 3;

let serverStatus = "down";

function dbg(msg) {
    console.log(msg);
};

function setStatus(msg) {
    if (msg === null || msg === undefined) return;
    serverStatus = msg;
    msgtext.innerText = "server status: " + serverStatus;
}

function lights() {
    const lightColor = 0xFFFFFF;
    let lightIntensity = 2;
    const ambientLight = new THREE.AmbientLight(lightColor, lightIntensity);
    scene.add(ambientLight);

    lightIntensity = 3;
    const directionalLight = new THREE.DirectionalLight(lightColor, 3);
    directionalLight.position.set(-1, 2, 4);
    scene.add(directionalLight);
}

function camera() {
    const fov = 60;
    const aspect = 2; // the canvas default
    const near = 0.1;
    const far = 25;
    const camera = new THREE.PerspectiveCamera( fov, aspect, near, far );

    camera.position.z = 15;
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 2, 0);
    controls.update();

    return camera;
}


const cylGeometry = new THREE.CylinderGeometry(1, 1, baseHeight, 6); // hexagon cross-section
const labelGeometry = new THREE.CircleGeometry(1, 64); // round disk for label

function makeDynamicLabelTexture(text) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  function update(newText) {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '48px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(newText, size / 2, size / 2);
    texture.needsUpdate = true;
  }

  const texture = new THREE.CanvasTexture(canvas);
  update(text);

  return { texture, update };
}

// --- Factory function ---
function makeCylWithLabel(color, text, vec) {
  dbg(`makeCylWithLabel(${color}, ${text}, ${vec[0]}, ${vec[1]}, ${vec[2]}`);
  const group = new THREE.Group();
  group.position.set(vec[0], vec[1], vec[2]);

  // Cylinder (unique material per cylinder)
  const cylMaterial = new THREE.MeshPhongMaterial({ color });
  const cylMesh = new THREE.Mesh(cylGeometry, cylMaterial);
  group.add(cylMesh);

  // Label (unique material + texture per label)
  const dynamicLabel = makeDynamicLabelTexture(text);
  const labelMaterial = new THREE.MeshBasicMaterial({
    map: dynamicLabel.texture,
    transparent: true,
    side: THREE.DoubleSide
  });
  const labelMesh = new THREE.Mesh(labelGeometry, labelMaterial);
  labelMesh.rotation.x = 0;
  labelMesh.position.y = baseHeight/2 + 0.2;
  group.add(labelMesh);

  // --- API: update height ---
  function updateHeight(scaleY) {
    cylMesh.scale.y = scaleY;
    cylMesh.position.y = baseHeight*(scaleY/2) - baseHeight/2;
    labelMesh.position.y = baseHeight*scaleY - baseHeight/2 + 0.2;
  }

  // Return group plus handles for updates
  return {
    group,           // add to scene
    cylMesh,         // access mesh
    cylMaterial,     // change color
    labelMesh,       // access label mesh
    labelUpdater: dynamicLabel.update, // change text
    updateHeight,    // change height
  };
}

// See https://www.redblobgames.com/grids/hexagons/
// These are axial coordinates [q, r] with s derived.
// The order of the offsets is designed along with the 
// Stockfish responses to place taller "terrain" at the
// back right and lower terrain at the front left. We put
// 0, 0, 0 in the offsets as offset [0] because Stockfish
// traces start with 1.

const offsets = [
    [ 0,  0], // 0, not a direction: s is 0
    [ 1, -1], // 1: s is 0
    [ 0, -1], // 2: s is 1
    [ 1,  0], // 3: s is -1
    [ 0,  1], // 4: s is -1
    [-1,  0], // 5: s is 1
    [-1,  1], // 6: s is 0
];

const sqrt3 = Math.sqrt(3);
const s3ov2 = sqrt3/2;
const t3ov2 = 3./2;

function xyzPos(stockfishIndex, distance) {
    const hex = offsets[stockfishIndex];
    const x   = sqrt3*hex[0]  +  s3ov2*hex[1];
    const z   =                  t3ov2*hex[1];
    return [x*distance, 0, z*distance];
}

const items = [
    makeCylWithLabel(0x44aa88, "start", xyzPos(0, 0)),
    makeCylWithLabel(0x8844aa, "e4",    xyzPos(1, 1)),
    makeCylWithLabel(0xaa8844, "d4",    xyzPos(2, 1)),
    makeCylWithLabel(0x2266aa, "Nc3",   xyzPos(3, 1)),
    makeCylWithLabel(0x6622aa, "Nf3",   xyzPos(4, 1)),
    makeCylWithLabel(0xaa6622, "c4",    xyzPos(5, 1)),
    makeCylWithLabel(0x886622, "b3",    xyzPos(6, 1)),
];

function main() {

    lights();
    const cam = camera();
    items.forEach(item => scene.add(item.group));

    // OK, Action!

    function resizeRendererToDisplaySize(renderer) {
      const canvas = renderer.domElement;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const needResize = canvas.width !== width || canvas.height !== height;
      if (needResize) {
        renderer.setSize(width, height, false);
      }
      return needResize;
    }

    const actualScale = [ 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, ];
    const targetScale = [ 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, ];
    let previousUpdate = 0;

    function render( time ) {

      // Every so often change the target height of all the bars
      if (time - previousUpdate > 1500) {
        previousUpdate = time;
        items.forEach((item, ndx) => {
          targetScale[ndx] = 1.5 - Math.random(); // range 0.5..1.5
          item.labelUpdater(new String(time));
        });
      }

      // Every frame converges the bars on the targets by small steps
      items.forEach((item, ndx) => {
        let diff = targetScale[ndx] - actualScale[ndx]
        if (Math.abs(diff) > 0.011) {
            if (diff > 0) {
              actualScale[ndx] += 0.01;
            } else {
              actualScale[ndx] -= 0.01;
            }
            item.updateHeight(actualScale[ndx]);
        }
      });

      if (resizeRendererToDisplaySize(renderer)) {
        const canvas = renderer.domElement;
        cam.aspect = canvas.clientWidth / canvas.clientHeight;
        cam.updateProjectionMatrix();
      }

      renderer.render( scene, cam );
      requestAnimationFrame( render );
    }

    requestAnimationFrame( render );
}

document.getElementById("c").addEventListener('keydown', (e) => {
    dbg("key: " + e.keyCode); // TODO 
});

// The web worker handles the link to the server that fronts Stockfish.

const worker = new Worker(new URL("worker.js", import.meta.url));

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

const outbound = new utils.MessageQueue();

// Parse UCI responses from Stockfish
// https://official-stockfish.github.io/docs/stockfish-wiki/UCI-&-Commands.html
// https://backscattering.de/chess/uci/
function parseResponse(fromServer) {
    dbg(`parseResponse(${fromServer})`);
    const words = fromServer.split(" ");
    switch (words[0]) {
    case "uciok":
        // Sent at the end of id and options in response to "uci". Init is complete.
        outbound.enqueue("setoption name MultiPV value 6\n");
        outbound.enqueue("setoption name UCI_ShowWDL value true\n");
        outbound.enqueue("ucinewgame\n");
        outbound.enqueue("isready\n");
        break;
    case "id":
        // next word "name" or "author"; we care about "name Stockfish"
        if (words[1] == "name") {
            if (words[2] != "Stockfish") {
                alert(`This program is designed to work with Stockfish.\n` +
                      `Execution continues, but ${words[2]} might not work correctly.`);
            }
        }
        break;
    case "option":
        // We care about option name MultiPV type spin default 1 min 1 max 256 type:stdout])
        // And option name UCI_ShowWDL type check default false type:stdout])
        // For now that's it; in the future, Threads, Ponder, and possibly others.
        break;
    case "readyok":
        // The engine is ready to receive commands.
        // For a quick hack, we assume this will be sent only after "ucinewgame"
        outbound.enqueue("position startpos\n");
        outbound.enqueue("go infinite\n");
        break;
    case "info":
        // The engine sends info periodically and we update the GUI .
        break;
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

setTimeout(doNet, 1453);
main();
