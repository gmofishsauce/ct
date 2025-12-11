import * as THREE from "three";
import * as utils from "./utils.js";
import * as comms from "./comms.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as position from "./board.js";

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

// === Hexcyl Class ===
// Encapsulates a labeled hexagonal cylinder with position, animation state,
// and visual properties. Replaces the previous nameless object type.

class Hexcyl {
  // Static constants
  static NEUTRAL_HEIGHT = 3.0;
  static NEUTRAL_SCALE = 1.0;
  static MIN_SCALE = 0.05;
  static MAX_SCALE = 1.95;
  static DEFAULT_STEP_SIZE = 0.01;

  // Shared geometries (one per class, not per instance)
  static #cylGeometry = new THREE.CylinderGeometry(1, 1, Hexcyl.NEUTRAL_HEIGHT, 6);
  static #labelGeometry = new THREE.CircleGeometry(1, 64);
  static #markerGeometry = new THREE.CircleGeometry(0.8, 64);

  // Private instance fields
  #qrVec;           // [q, r] axial coordinates (immutable)
  #group;           // THREE.Group (root container)
  #cylMesh;         // THREE.Mesh (cylinder)
  #cylMaterial;     // THREE.MeshPhongMaterial
  #labelMesh;       // THREE.Mesh (label disk)
  #labelTexture;    // { texture, update } from makeDynamicLabelTexture
  #markerMesh;      // THREE.Mesh (gold marker for played moves)
  #targetScale;     // animation target
  #actualScale;     // current scale value
  #label;           // move notation (e.g., "e2e4")
  #paused;          // activity state (whether updates are paused)

  // Private constructor - use Hexcyl.create() instead
  constructor(qrVec, initialLabel) {
    this.#qrVec = [qrVec[0], qrVec[1]]; // defensive copy
    this.#label = initialLabel;
    this.#paused = false;
    this.#targetScale = Hexcyl.NEUTRAL_SCALE;
    this.#actualScale = Hexcyl.MIN_SCALE; // cylinders initially "grow" into scene

    // Create THREE.js group and position it
    this.#group = new THREE.Group();
    const xyzVec = Hexcyl.#xyzPos(this.#qrVec);
    this.#group.position.set(xyzVec[0], xyzVec[1], xyzVec[2]);
    this.#group.name = "GROUP";
    this.#group.userData.hexcyl = this; // back-reference for picking

    // Create cylinder mesh
    const color = utils.makeHexColor(0);
    this.#cylMaterial = new THREE.MeshPhongMaterial({ color });
    this.#cylMesh = new THREE.Mesh(Hexcyl.#cylGeometry, this.#cylMaterial);
    this.#cylMesh.name = "CYL";
    this.#group.add(this.#cylMesh);

    // Create label mesh with dynamic texture
    this.#labelTexture = Hexcyl.#makeDynamicLabelTexture(initialLabel);
    const labelMaterial = new THREE.MeshBasicMaterial({
      map: this.#labelTexture.texture,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.#labelMesh = new THREE.Mesh(Hexcyl.#labelGeometry, labelMaterial);
    this.#labelMesh.rotation.x = 0;
    this.#labelMesh.position.y = Hexcyl.NEUTRAL_HEIGHT / 2 + 0.2;
    this.#labelMesh.name = "LABEL";
    this.#group.add(this.#labelMesh);

    // Create marker mesh (gold disc for played moves)
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0xFFD700, // gold color
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    this.#markerMesh = new THREE.Mesh(Hexcyl.#markerGeometry, markerMaterial);
    this.#markerMesh.rotation.x = Math.PI / 2; // lay flat on top
    this.#markerMesh.position.y = Hexcyl.NEUTRAL_HEIGHT / 2 + 0.05;
    this.#markerMesh.name = "MARKER";
    this.#markerMesh.visible = false; // initially hidden
    this.#group.add(this.#markerMesh);
  }

  // === STATIC FACTORY ===

  static create(qrVec, label) {
    return new Hexcyl(qrVec, label);
  }

  static fromGroup(group) {
    return group?.userData?.hexcyl || null;
  }

  // === GETTERS (read-only access) ===

  get qrVec() {
    return [this.#qrVec[0], this.#qrVec[1]]; // return copy
  }

  get q() {
    return this.#qrVec[0];
  }

  get r() {
    return this.#qrVec[1];
  }

  get group() {
    return this.#group;
  }

  get label() {
    return this.#label;
  }

  get isPaused() {
    return this.#paused;
  }

  get isMarkedAsPlayed() {
    return this.#markerMesh.visible;
  }

  get targetScale() {
    return this.#targetScale;
  }

  get actualScale() {
    return this.#actualScale;
  }

  // === PUBLIC METHODS ===

  setLabel(newLabel) {
    this.#label = newLabel;
    this.#labelTexture.update(newLabel);
    return this;
  }

  setColor(pawnValue) {
    const color = utils.makeHexColor(pawnValue);
    this.#cylMaterial.color.setStyle(color);
    return this;
  }

  setTargetScale(scale) {
    this.#targetScale = scale;
    return this;
  }

  // Combined operation: set label, color, and target scale based on evaluation
  setEvaluation(pawnValue, moveName) {
    this.setLabel(moveName);
    this.setColor(pawnValue);
    this.#targetScale = this.#boundScale(pawnValue);
    return this;
  }

  // Animation: converge actual scale toward target scale
  // Returns true if still animating, false if complete
  convergeScale(stepSize = Hexcyl.DEFAULT_STEP_SIZE) {
    const diff = this.#targetScale - this.#actualScale;
    if (Math.abs(diff) > stepSize + 0.001) {
      if (diff > 0) {
        this.#actualScale += stepSize;
      } else {
        this.#actualScale -= stepSize;
      }
      this.#updateHeight(this.#actualScale);
      return true;
    }
    return false;
  }

  pause() {
    this.#paused = true;
    return this;
  }

  resume() {
    this.#paused = false;
    return this;
  }

  markAsPlayed() {
    this.#markerMesh.visible = true;
    return this;
  }

  unmarkAsPlayed() {
    this.#markerMesh.visible = false;
    return this;
  }

  isInScene() {
    return this.#group.parent !== null;
  }

  addToScene(scene) {
    scene.add(this.#group);
    return this;
  }

  removeFromScene() {
    this.#group.parent?.remove(this.#group);
    return this;
  }

  lookAtCamera(cameraPosition) {
    this.#labelMesh.lookAt(cameraPosition);
    return this;
  }

  // === PRIVATE HELPERS ===

  #updateHeight(scaleY) {
    this.#cylMesh.scale.y = scaleY;
    this.#cylMesh.position.y = Hexcyl.NEUTRAL_HEIGHT * (scaleY / 2) - Hexcyl.NEUTRAL_HEIGHT / 2;
    this.#labelMesh.position.y = Hexcyl.NEUTRAL_HEIGHT * scaleY - Hexcyl.NEUTRAL_HEIGHT / 2 + 0.2;
    this.#markerMesh.position.y = Hexcyl.NEUTRAL_HEIGHT * scaleY - Hexcyl.NEUTRAL_HEIGHT / 2 + 0.05;
  }

  #boundScale(pawnValue) {
    if (pawnValue < -5.0) pawnValue = -5.0;
    if (pawnValue > 5.0) pawnValue = 5.0;
    let result = Hexcyl.NEUTRAL_SCALE + pawnValue / 5.0;
    if (result < Hexcyl.MIN_SCALE) result = Hexcyl.MIN_SCALE;
    if (result > Hexcyl.MAX_SCALE) result = Hexcyl.MAX_SCALE;
    return result;
  }

  // === STATIC PRIVATE HELPERS ===

  static #xyzPos(qrVec) {
    const sqrt3 = Math.sqrt(3);
    const s3ov2 = sqrt3 / 2;
    const t3ov2 = 3 / 2;
    const x = sqrt3 * qrVec[0] + s3ov2 * qrVec[1];
    const z = t3ov2 * qrVec[1];
    return [x, 0.0, z];
  }

  static #makeDynamicLabelTexture(text) {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    function update(newText) {
      ctx.clearRect(0, 0, size, size);
      // This probably isn't right ... we may create hexes not for the player on the move.
      ctx.fillStyle = (position.chess.turn() == 'w') ? '#FFFFFF' : '#000000';
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
// scene, (2) inactive (paused) and visible because the center has moved
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
// Pauses all the hexcyls in the terrain. Only newly-added ones
// are active (not paused). Note: labels of paused state (1)
// (meaning "visible") hexcyls still rotate to point at the cam.
function pauseAll() {
  hexcyls.forEach((hexcyl) => {
    hexcyl.pause();
  });
}

// Called when the Go button is clicked on a new FEN string and
// the scene is cleared. Ensures that hexcyls reclaimed from the
// hexcyls map will not be paused when reclaimed.
function resumeAll() {
  hexcyls.forEach((hexcyl) => {
    hexcyl.resume();
  });
}

function makeActive(hexcyl) {
  activeKeys.push(hexcyl);
  // Don't set label here - let engine analysis set proper move notation
  // updateView(activeKeys.length-1, 0.0, keyFor(hexcyl.qrVec));
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
      // Reset to neutral state when reclaiming
      // Use "..." as placeholder - engine will set proper move notation
      result.setEvaluation(0.0, "...");
      result.unmarkAsPlayed();
      scene.add(result.group);
      makeActive(result);
      utils.dbg(`STATE ${keyFor(result.qrVec)} (3)=>(1)`);
    } else {
      // state (2) => (1) - already visible (paused), being repurposed for new analysis
      // Reset to neutral state and add to activeKeys so engine can update it
      // Keep gold marker if present (preserves move path history)
      result.setEvaluation(0.0, "...");
      makeActive(result);
      utils.dbg(`STATE ${keyFor(result.qrVec)} (2)=>(1)`);
    }
    return result;
  }

  // creation => state(1)
  // Use "..." as placeholder - engine will set proper move notation
  const result = Hexcyl.create(qrVec, "...");
  utils.dbg(`STATE ${keyFor(result.qrVec)} creation=>(1)`);
  hexcyls.set(k, result);
  scene.add(result.group);
  makeActive(result);
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
  if (hex && !hex.isPaused) {
    hex.setEvaluation(value, name);
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
      hexcyl.convergeScale();
    });

    if (cameraPositionChanged) {
      hexcyls.forEach((hexcyl) => {
        if (hexcyl.isInScene()) {
          hexcyl.lookAtCamera(cam.position);
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
    v.removeFromScene();
  }
  resumeAll();
  basisVectors.forEach((qrVec) => {
    // including [0, 0] ... this is how
    // the center hexcyl comes into existence:
    requireHexcylAt(qrVec);
  });

  // Label and mark the center hexcyl appropriately
  const centerHexcyl = hexcyls.get("0-0");
  if (centerHexcyl) {
    const startingFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    if (currentFen === startingFen) {
      centerHexcyl.setLabel("start");
    } else {
      // Try to get the last move from chess history
      const history = position.chess.history({ verbose: true });
      if (history.length > 0) {
        const lastMove = history[history.length - 1];
        centerHexcyl.setLabel(lastMove.from + lastMove.to);
      } else {
        centerHexcyl.setLabel("start");
      }
    }
    centerHexcyl.markAsPlayed();
  }

  primaryServer.startEngine(currentFen);
}

// Restart the chess server working on a new position in the
// same "game" (continuous exploration thread). Essentially
// this means we do not send "ucinewgame" and no visible hexcyls
// are removed from the display.
function softRestart(newCenter) {
  primaryServer.stop();
  activeKeys = [];
  pauseAll();
  activeKeys.push(newCenter);
  newCenter.resume(); // Unpause the center hexcyl
  newCenter.markAsPlayed(); // Mark as a played move

  // Now add in the new hexcyls that will expand the terrain
  // These will be the only unpaused hexcyls in the entire terrain.
  // Have to skip basisVectors[0] which is [0, 0].
  // Also skip any positions that already contain played moves (preserve history)
  for (let i = 1; i < basisVectors.length; i++) {
    let bv = basisVectors[i];
    let qr = [ newCenter.qrVec[0]+bv[0], newCenter.qrVec[1]+bv[1] ];
    let key = keyFor(qr);

    // Check if this position already has a played move - if so, skip it
    if (hexcyls.has(key)) {
      const existingHex = hexcyls.get(key);
      if (existingHex.isMarkedAsPlayed) {
        utils.dbg(`Skipping ${key} - already part of move history`);
        continue;
      }
    }

    const newHex = requireHexcylAt(qr);
    newHex.resume(); // Ensure newly created/reclaimed hexcyls are unpaused
  }

  currentFen = position.chess.fen();
  utils.dbg(`Move to FEN: ${currentFen}`);
  position.board.setPosition(currentFen);
  actionText.value = currentFen;
  primaryServer.move(currentFen);
}

const goButton = document.getElementById("go");
const actionText = document.getElementById("action");

function doGoClick() {
  const proposedFen = actionText.value;
  const validator = position.validate(proposedFen);
  if (!validator.ok) {
    alert(`Invalid FEN: ${proposedFen}\n${validator.error}`);
    return;
  }
  currentFen = proposedFen;
  position.chess.load(currentFen);
  utils.dbg("doGoClick:position loaded");
  position.board.setPosition(currentFen);
  hardRestart();
}

// "Hard" restart. Empty the terrain and the active set. Remove
// all hexcyls from the scene ((1) => (3) and (2) => (3) transitions;
// see the long comment about hexcyl states). Send the chess engine
// a stop and a ucinewgame so it dumps its transposition table.
goButton.addEventListener("click", function () {
  doGoClick();
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
  // Check if label looks like a valid move (e.g., "e2e4" not "1--1")
  // Valid moves are 4-5 characters like "e2e4" or "e7e8q" (with promotion)
  if (!picked.label || picked.label.length < 4 || picked.label.length > 5) {
    utils.dbg(`hexcyl label "${picked.label}" doesn't look like a valid move, ignoring click`);
    return;
  }
  // OK, the user clicked on live hexcyl to expand from that point.
  try {
    position.chess.move(picked.label);
  } catch (err) {
    // User probably clicked on a random hexcyl
    utils.dbg(`illegal move to ${picked.label} ignored`);
    return;
  }

  softRestart(picked);
});

// User made a legal move on the chessboard component.
function positionChangedHandler(evt) {
  const label = evt.wrappedEvent.squareFrom + evt.wrappedEvent.squareTo; // XXX TODO promotion
  utils.dbg(`position changed: ${label}`);

  let newCenter = null;
  activeKeys.some(hexcyl => {
    if (label == hexcyl.label) {
      newCenter = hexcyl;
      return true;
    }
    return false;
  });
  if (newCenter != null) {
    utils.dbg(`position changed: case 1 (move was active)`);
    softRestart(newCenter);
    return;
  }

  // Special case: the app just opened and there are no hexcyls.
  // The user made a move on the board instead of clicking "Go".
  if (hexcyls.size == 0) {
    utils.dbg(`position changed: case 2 (initialization)`);
    actionText.value = position.chess.fen();
    doGoClick();
    return;
  }

  // In progress and user made a move that wasn't an active hexcyl.
  // Analysis is in progress so there are active hexcyls (we sanity
  // check) and we must "repurpose" on of the active hexcyls. We
  // don't have
  if (activeKeys.length < 2) {
    alert("internal error: move recenter");
    return;
  }

  utils.dbg(`position changed: case 3 (repurpose a hex)`);
  newCenter = activeKeys[1];
  newCenter.setEvaluation(0.0, label);
  softRestart(newCenter);
}

// Finally, start me up.
// XXX TODO call hardReset() here?

position.addEventListener(positionChangedHandler);
position.start();
primaryServer = new comms.ServerConnection(updateView);
actionText.value = currentFen;
primaryServer.start();
main();
