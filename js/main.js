import * as THREE from "three";
import * as utils from "./utils.js";
import * as comms from "./comms.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

function dbg(msg) {
  console.log(msg);
}

const canvas = document.querySelector("#c");
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
const scene = new THREE.Scene();

let primaryServer = null;

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
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 2, 0);
  controls.update();

  return camera;
}

const cam = camera();

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
  return {
    group, // add to scene
    cylMesh, // access mesh
    cylMaterial, // change color
    labelMesh, // access label mesh
    updateLabel: dynamicLabel.update,
    updateHeight, // change height
    targetScale: neutralScale,
    actualScale: minScale, // cylinders initially "grow" into the scene
    qrVec,
  };
}

// Hexcyl management. The center hexcyl is statically created below. The
// user must begin by entering a starting position and clicking Go. Six
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

function hexcylExists(qrVec) {
  return hexcyls.has(keyFor(qrVec));
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
    if (result.parent == null) {
      // state (3) => (1)
      scene.add(result.group);
      makeActive(result);
      dbg(`STATE ${keyFor(result.qrVec)} (3)=>(1)`);
    } else {
      // state (1) => (2)
      // Click handler should have cleared activeKeys
      // So: nothing to do here for now, but:
      // TODO visual indication of "frozen" state
      dbg(`STATE ${keyFor(result.qrVec)} (1)=>(2)`);
    }
    return result;
  }

  // creation => state(1)
  const result = makeHexcyl(qrVec, k);
  dbg(`STATE ${keyFor(result.qrVec)} creation=>(1)`);
  hexcyls.set(k, result);
  scene.add(result.group);
  makeActive(result);
  return result;
}

let center = requireHexcylAt([0, 0], "Center");

function boundScale(pawnValue) {
  let result = neutralScale + pawnValue / 2.0;
  if (result < minScale) result = minScale;
  if (result > maxScale) result = maxScale;
  return result;
}

function updateView(index, value, name) {
  if (index > 0 && index < activeKeys.length) {
    activeKeys[index].updateLabel(name);
    activeKeys[index].cylMaterial.color.setStyle(utils.makeHexColor(value));
    activeKeys[index].targetScale = boundScale(value);
  }
}

function main() {
  lights();

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
      // TODO there's no need for this unless the camera position
      // has changed. Can we efficiently detect changes in the
      // camera position?
      hexcyl.labelMesh.lookAt(cam.position);
    });

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

document.getElementById("c").addEventListener("keydown", (e) => {
  dbg("key: " + e.keyCode); // TODO
});

const goButton = document.getElementById("go");
const actionText = document.getElementById("action");

// "Hard" restart. Empty the terrain and the active set. Remove
// all hexcyls from the scene ((1) => (3) and (2) => (3) transitions;
// see the long comment about hexcyl states). Send the chess engine
// a stop and a ucinewgame so it dumps its transposition table.
goButton.addEventListener("click", function () {
  const s = actionText.value;
  dbg(`go: ${s}`);

  let cmd = null;
  if (s && s.length > 0) {
    // is a FEN with optional "moves ..." at the end?
    const fields = s.split(" ");
    if (fields.length >= 6 && fields[0].includes("/")) {
      cmd = "fen " + s;
    } else if (s.startsWith("startpos")) {
      cmd = s;
    }
  }

  if (cmd == null) {
    // "Garbage" in the action text box.
    // TODO set the background color or something instead of this rude behavior
    actionText.value = ""
  } else {
    // All hexcyls transition to state (3),
    // not visible but reclaimable.
    activeKeys = [];
    for (const [k, v] of hexcyls) {
      dbg(`STATE ${k} (1),(2)=>(3)`);
      scene.remove(v.group);
    }
    center = requireHexcylAt([0, 0], "Center");
    primaryServer.startEngine(cmd);
  }
});

const pickHelper = new utils.PickHelper();

function getCanvasRelativePosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * canvas.width) / rect.width,
    y: ((event.clientY - rect.top) * canvas.height) / rect.height,
  };
}

// TODO:
// When user clicks:
//   clear active set
//   iterate [qrVec] neighbors:
//      if not exist(neighborQR):
//        create it; add it to activeKeys
// So only the click handler ever calls requireHexcylAt().
// Really "click handlerS" for canvas and for Go button.
// And requireHexcylAt() can just default the color and text.
// Maintaining the text to avoid rewriting the label texture
//   is a nice optimization but just an optimization.

document.getElementById("c").addEventListener("click", (e) => {
  dbg(`click ${e.clientX} ${e.clientY}`);
  const pos = getCanvasRelativePosition(e);
  const x = (pos.x / canvas.width) * 2 - 1;
  const y = (pos.y / canvas.height) * -2 + 1; // note we flip Y
  pickHelper.pick(x, y, scene, cam);
});

// Finally, start me up.

primaryServer = new comms.ServerConnection(updateView);
primaryServer.start();
main();
