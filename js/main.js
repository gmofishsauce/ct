import * as THREE from "three";
import * as utils from "./utils.js";
import * as comms from "./comms.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as position from "./board.js";

// TODO black and white indication in the hexcyl display

// See https://www.redblobgames.com/grids/hexagons/
// These are axial coordinates [q, r] with s derived.

const basisVectors = [
  [0, 0], // 0, not a direction: s is 0
  [1, -1], // s is 0
  [1, 0], // s is -1
  [0, 1], // s is -1
  [-1, 1], // s is 0
  [-1, 0], // s is 1
  [0, -1], // s is 1
];

const canvas = document.querySelector("#c");
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
const scene = new THREE.Scene();

let primaryServer = null;
let currentFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" // start

function lights() {
  const lightColor = 0xffffff;
  let lightIntensity = 2;
  const ambientLight = new THREE.AmbientLight(lightColor, lightIntensity);
  scene.add(ambientLight);

  lightIntensity = 3;
  const directionalLight = new THREE.DirectionalLight(lightColor, 3);
  directionalLight.position.set(-1, 2, 4);
  scene.add(directionalLight);

  scene.background = new THREE.Color(0x505050);
}

function camera() {
  const fov = 60;
  const aspect = 2; // the canvas default
  const near = 0.1;
  const far = 25;
  const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.z = 15;
  return camera;
}

const cam = camera();

function newCameraControls() {
  const controls = new OrbitControls(cam, canvas);
  controls.target.set(0, 2, 0);
  controls.update();
  return controls;
}

const cameraControls = newCameraControls();

// The "base height" of the hexagonal cylinders is their height when the
// move evaluation is 0 centipawns (neither positive nor negative for the
// player). The scaling range runs from 0.05 (cylinder's height is 5% of
// neutralHeight) to 2.45 (245% of neutralHeight). Actual scales converge
// by 0.01 per frame to target scales so the cylinder heights change smoothly
// as the evaluation proceeds. We initialize so that the cylinders grow
// toward the neutral height during initialization.
const neutralHeight = 3.0;
const neutralScale = 1.0;
const minScale = 0.05;
const maxScale = 1.95;

const cylGeometry = new THREE.CylinderGeometry(1, 1, neutralHeight, 6);
const labelGeometry = new THREE.CircleGeometry(1, 64); // round disk for label

// TODO indicate color {black, white} of each move. Currently best
// idea is to color the move text black or white.
function makeDynamicLabelTexture(text) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  function update(newText) {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#000000";
    ctx.font = "48px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(newText, size / 2, size / 2);
    texture.needsUpdate = true;
  }

  const texture = new THREE.CanvasTexture(canvas);
  update(text);

  return { texture, update };
}

// The hexcyl (a labeled hexagonal cylinder) is the fundamental graphical
// object in this app. Each hexcyl has a color that varies over a gradient,
// a label, a scalable height, and a position expressed in {q, r} axial
// hexagonal coordinates, usually packaged as a qrVec which is an array
// of length 2. This factory function is usually reached via requireHexcylAt()
// which participates in the management strategy for these graphical objects.
// The strategy is described in a later comment.

function makeHexcyl(qrVec, text) {
  const group = new THREE.Group();
  const xyzVec = utils.xyzPos(qrVec);
  group.position.set(xyzVec[0], xyzVec[1], xyzVec[2]);
  group.name = "GROUP";

  // Cylinder (unique material per cylinder)
  const color = utils.makeHexColor(0);
  const cylMaterial = new THREE.MeshPhongMaterial({ color });
  const cylMesh = new THREE.Mesh(cylGeometry, cylMaterial);
  cylMesh.name = "CYL"; // used in PickHelper
  group.add(cylMesh);

  // Label (unique material + texture per label)
  const dynamicLabel = makeDynamicLabelTexture(text);
  const labelMaterial = new THREE.MeshBasicMaterial({
    map: dynamicLabel.texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const labelMesh = new THREE.Mesh(labelGeometry, labelMaterial);
  labelMesh.rotation.x = 0;
  labelMesh.position.y = neutralHeight / 2 + 0.2;
  labelMesh.name = "LABEL";
  group.add(labelMesh);

  // --- API: update height ---
  function updateHeight(scaleY) {
    cylMesh.scale.y = scaleY;
    cylMesh.position.y = neutralHeight * (scaleY / 2) - neutralHeight / 2;
    labelMesh.position.y = neutralHeight * scaleY - neutralHeight / 2 + 0.2;
  }

  // Return group plus handles for updates
  // XXX FIXME this design is ridiculous. It was proposed by an AI as a
  // graphics example, and one thing led to another. All these properties
  // should be on the Three.js group object and this nameless return type
  // should not even exist. N.B. - the PickHelper in utils.js identifies
  // the group when it's clicked, and the .owner is required to get back
  // to the qrVec of the selected group. Bogus. Hopefully I can get an AI
  // to refactor the entire code base to get rid of this thing.
  const result = {
    group, // add to scene
    cylMesh, // access mesh
    cylMaterial, // change color
    labelMesh, // access label mesh
    updateLabel: dynamicLabel.update,
    updateHeight, // change height
    targetScale: neutralScale,
    actualScale: minScale, // cylinders initially "grow" into the scene
    frozen: false,
    label: text,
    qrVec,
  };
  group.owner = result;
  return result;
}

// Hexcyl management. The user must begin by entering a starting position
// and clicking Go. The center hexcyl is created if it doesn't exist. Six
// hexcyls are allocated, added to the hexcyls map and placed in activeKeys
// in the correct ordering to ensure the terrain ramps up toward the back
// right (northeast). Each time the Go button is pressed all hexcyls are
// removed from the scene and from activeKeys but not from the hexcyls map.
// Now requireHexcylAt() will rediscover the hexcyls and will not recreate
// them; they will be added to activeKeys and the scene. When the user clicks
// a hexcyl to expand it, activeKeys is cleared but of course the scene is
// not. The clicked hexcyl becomes the logical center. The click handler
// iterates its neighbors, creating or reclaiming hexcyls to surround the
// logical center. Previously-invisible hexcyls become the new active set.
//
// So hexcyls have three possible states: (1) active and visible in the
// scene, (2) inactive (frozen) and visible because the center has moved
// away from them, (3) not visible in the scene, eligible for reclaiming,
// and not active. State transitions are creation => (1), (1) => (3) and
// (2) => (3) when Go button pressed and all hexcyls are removed from the
// scene, (1) => (2) when an active hexcyl is clicked and the center moves,
// and (3) => (1) when a hexcyl not in the scene is reclaimed.

const hexcyls = new Map(); // "q-r" => hexcyl obj
let activeKeys = []; // ordered (sub)set of animated hexcyls

function keyFor(qrVec) {
  return `${qrVec[0]}-${qrVec[1]}`;
}

// Called when the terrain is expanded by clicking on a hexcyl.
// Freezes all the hexcyls in the terrain. Only newly-added ones
// are active (not frozen). Note: labels of frozen state (1)
// (meaning "visible") hexcyls still rotate to point at the cam.
function freezeAll() {
  hexcyls.forEach((hexcyl) => {
    hexcyl.frozen = true;
  });
}

// Called when the Go button is clicked on a new FEN string and
// the scene is cleared. Ensures that hexcyls reclaimed from the
// hexcyls map will not be frozen when reclaimed.
function unfreezeAll() {
  hexcyls.forEach((hexcyl) => {
    hexcyl.frozen = false;
  });
}

// TODO northeast-priority ordering
function makeActive(hexcyl) {
  activeKeys.push(hexcyl);
  updateView(activeKeys.length-1, 0.0, keyFor(hexcyl.qrVec));
}

function requireHexcylAt(qrVec) {
  const k = keyFor(qrVec);

  if (hexcyls.has(k)) {
    const result = hexcyls.get(k);
    if (activeKeys.includes(result)) {
      return result;
    }
    if (result.group.parent == null) {
      // state (3) => (1)
      scene.add(result.group);
      makeActive(result);
      utils.dbg(`STATE ${keyFor(result.qrVec)} (3)=>(1)`);
    } else {
      // state (1) => (2)
      // Click handler should have cleared activeKeys
      // TODO visual indication of "frozen" state
      utils.dbg(`STATE ${keyFor(result.qrVec)} (1)=>(2)`);
    }
    return result;
  }

  // creation => state(1)
  const result = makeHexcyl(qrVec, k);
  utils.dbg(`STATE ${keyFor(result.qrVec)} creation=>(1)`);
  hexcyls.set(k, result);
  scene.add(result.group);
  makeActive(result);
  return result;
}

function boundScale(pawnValue) {
  let result = neutralScale + pawnValue / 2.0;
  if (result < minScale) result = minScale;
  if (result > maxScale) result = maxScale;
  return result;
}

function updateView(index, value, name) {
  if (index < 1 || index >= activeKeys.length) {
    // This happens all the time, for now, because we always let the engine
    // evaluate six threads and only use the top three threads after the
    // user starts clicking hexes to expand the terrain. All six threads
    // are only used for the six best moves after the Go button is clicked.
    // TODO optimize by sending a smaller MultiPV to the server in the click
    // handler for terrain clicks. This would be a new comms call argument.
    // utils.dbg(`updateView(${index}, ${value}, ${name}): activeKeys.length is ${activeKeys.length}`);
    return;
  }

  const hex = activeKeys[index];
  if (hex && !hex.frozen) {
    hex.label = name; // XXX TODO FIXME another sign of screwed-up object structure
    hex.updateLabel(name);
    hex.cylMaterial.color.setStyle(utils.makeHexColor(value));
    hex.targetScale = boundScale(value);
  }
}

let cameraPositionChanged = false;

function onCameraPositionChange(o) {
  cameraPositionChanged = true;
}

function main() {
  lights();
  // Make all the visible labels look at the camera when it moves:
  cameraControls.addEventListener('change', onCameraPositionChange);

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

  function render(time) {
    // Every frame converges the bars on the targets by small steps
    activeKeys.forEach((hexcyl) => {
      let diff = hexcyl.targetScale - hexcyl.actualScale;
      if (Math.abs(diff) > 0.011) {
        if (diff > 0) {
          hexcyl.actualScale += 0.01;
        } else {
          hexcyl.actualScale -= 0.01;
        }
        hexcyl.updateHeight(hexcyl.actualScale);
      }
    });

    if (cameraPositionChanged) {
      hexcyls.forEach ((hexcyl) => {
        if (hexcyl.group.parent) { // it's in the scene
          hexcyl.labelMesh.lookAt(cam.position);
        }
      });
    }

    if (resizeRendererToDisplaySize(renderer)) {
      const canvas = renderer.domElement;
      cam.aspect = canvas.clientWidth / canvas.clientHeight;
      cam.updateProjectionMatrix();
    }

    renderer.render(scene, cam);
    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

// Clear the terrain and restart the chess server
// on a FEN provided by the user (or in the initial
// position at startup time).
function hardRestart() {
  // All hexcyls transition to state (3),
  // not visible but reclaimable.
  activeKeys = [];
  for (const [k, v] of hexcyls) {
    utils.dbg(`STATE ${k} (1),(2)=>(3)`);
    scene.remove(v.group);
  }
  unfreezeAll();
  basisVectors.forEach((qrVec) => {
    // including [0, 0]:
    requireHexcylAt(qrVec);
  });
  primaryServer.startEngine(currentFen);
}

// Restart the chess server working on a new position in the
// same "game" (continuous exploration thread). Essentially
// this means we do not send "ucinewgame" and no visible hexcyls
// are removed from the display.
function softRestart(newCenter) {
  primaryServer.stop();
  activeKeys = [];
  freezeAll();
  activeKeys.push(newCenter);

  // Now add in the new hexcyls that will expand the terrain
  // These will be the only unfrozen hexcyls in the entire terrain.
  // Have to skip basisVectors[0] which is [0, 0].
  for (let i = 1; i < basisVectors.length; i++) {
    let bv = basisVectors[i];
    let qr = [ newCenter.qrVec[0]+bv[0], newCenter.qrVec[1]+bv[1] ];
    let key = keyFor(qr);
    if (!hexcyls.has(key)) {
      requireHexcylAt(qr);
    }
  }

  currentFen = position.chess.fen();
  utils.dbg(`Move to FEN: ${currentFen}`);
  position.board.setPosition(currentFen);
  primaryServer.move(currentFen);
}

const goButton = document.getElementById("go");
const actionText = document.getElementById("action");

// "Hard" restart. Empty the terrain and the active set. Remove
// all hexcyls from the scene ((1) => (3) and (2) => (3) transitions;
// see the long comment about hexcyl states). Send the chess engine
// a stop and a ucinewgame so it dumps its transposition table.
goButton.addEventListener("click", function () {
  const proposedFen = actionText.value;
  const validator = position.validate(proposedFen);
  if (!validator.ok) {
    alert(`Invalid FEN: ${proposedFen}\n${validator.error}`);
    return;
  }
  currentFen = proposedFen;
  hardRestart();
});

const pickHelper = new utils.PickHelper();

function getCanvasRelativePosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * canvas.width) / rect.width,
    y: ((event.clientY - rect.top) * canvas.height) / rect.height,
  };
}

document.getElementById("c").addEventListener("click", (e) => {
  // PickHelper.pick() returns the type-nameless hexcyl object.
  utils.dbg(`click ${e.clientX} ${e.clientY}`);
  const pos = getCanvasRelativePosition(e);
  const x = (pos.x / canvas.width) * 2 - 1;
  const y = (pos.y / canvas.height) * -2 + 1; // note we flip Y
  const picked = pickHelper.pick(x, y, scene, cam);
  // Clicking the center hexcyl doesn't do anything.
  if (picked == null || picked == activeKeys[0]) {
    return;
  }
  // OK, the user clicked on live hexcyl to expand from that point.
  try {
    position.chess.move(picked.label);
  } catch (err) {
    // User probably clicked on a random hexcyl
    // TODO cancel highlighting of hexcyl
    dbg(`illegal move to ${newCenter.label} ignored`);
    return;
  }

  softRestart(picked);
});

// User made a legal move on the chessboard
function positionChangedHandler(evt) {
  utils.dbg("positionChangedHandler");
  utils.dbobj(evt.wrappedEvent);
  const label = evt.wrappedEvent.squareFrom + evt.wrappedEvent.squareTo;
  utils.dbg(`label: ${label}`);
  let newCenter = null;
  activeKeys.some(hexcyl => {
    if (label == hexcyl.label) {
      newCenter = hexcyl;
      return true;
    }
    return false;
  });
  if (newCenter == null) {
    // user made a move that wasn't already a hexcyl;
    // find an empty neighboring hexcyl and use it.
    // There will be one, because only legal moves
    // are allowed and they are all at the frontier.
    for (let i = 1; i < basisVectors.length; i++) {
      let bv = basisVectors[i];
      let qr = [ newCenter.qrVec[0]+bv[0], newCenter.qrVec[1]+bv[1] ];
      let key = keyFor(qr);
      if (!hexcyls.has(key)) {
        newCenter = requireHexcylAt(qr);
        // XXX refactoring required - this is essentially updateView():
        // it's required (?) in case the new center is reclaimed hexcyl (?)
        newCenter.label = label; // XXX TODO FIXME another sign of screwed-up object structure
        newCenter.updateLabel(label);
        newCenter.cylMaterial.color.setStyle(utils.makeHexColor(0.0));
        newCenter.targetScale = boundScale(0.0);
      }
    }
  }
  if (newCenter == null) {
    console.warn("move update failed for hexcyls");
    return;
  }
  softRestart(newCenter);
}

// Finally, start me up.

position.addEventListener(positionChangedHandler);
position.start();
primaryServer = new comms.ServerConnection(updateView);
actionText.value = currentFen;
primaryServer.start();
main();
