import * as THREE from 'three';
import * as utils from './utils.js'
import * as comms from './comms.js'
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const canvas = document.querySelector( '#c' );
const renderer = new THREE.WebGLRenderer( { antialias: true, canvas } );
const scene = new THREE.Scene();

// The "base height" of the hexagonal cylinders is their height when the
// move evaluation is 0 centipawns (neither positive nor negative for the
// player). The scaling range runs from 0.05 (cylinder's height is 5% of
// neutralHeight) to 2.45 (245% of neutralHeight). Actual scales converge
// by 0.01 per frame to target scales so the cylinder heights change smoothly
// as the evaluation proceeds. We initialize so that the cylinders grow
// toward the neutral height during initialization.
const neutralHeight = 2.5;
const neutralScale = 1.0
const minScale = 0.05;
const maxScale = 2.45;
const actualScale = [ minScale, minScale, minScale, minScale, minScale, minScale, minScale, ];
const targetScale = [ neutralScale, neutralScale, neutralScale, neutralScale, neutralScale, neutralScale, neutralScale, ];

function dbg(msg) {
    console.log(msg);
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

    scene.background = new THREE.Color(0x505050);
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


const cylGeometry = new THREE.CylinderGeometry(1, 1, neutralHeight, 6); // hexagon cross-section
const labelGeometry = new THREE.CircleGeometry(1, 64); // round disk for label

function makeDynamicLabelTexture(text) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  function update(newText) {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
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
  labelMesh.position.y = neutralHeight/2 + 0.2;
  group.add(labelMesh);

  // --- API: update height ---
  function updateHeight(scaleY) {
    cylMesh.scale.y = scaleY;
    cylMesh.position.y = neutralHeight*(scaleY/2) - neutralHeight/2;
    labelMesh.position.y = neutralHeight*scaleY - neutralHeight/2 + 0.2;
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

const items = [
    makeCylWithLabel(utils.makeHexColor(0), "0", utils.xyzPos(0, 0)),
    makeCylWithLabel(utils.makeHexColor(0), "1", utils.xyzPos(1, 1)),
    makeCylWithLabel(utils.makeHexColor(0), "2", utils.xyzPos(2, 1)),
    makeCylWithLabel(utils.makeHexColor(0), "3", utils.xyzPos(3, 1)),
    makeCylWithLabel(utils.makeHexColor(0), "4", utils.xyzPos(4, 1)),
    makeCylWithLabel(utils.makeHexColor(0), "5", utils.xyzPos(5, 1)),
    makeCylWithLabel(utils.makeHexColor(0), "6", utils.xyzPos(6, 1)),
];

function updateView(index, value, name) {
    if (index > 0 && index < items.length) {
        dbg(`update ${index} ${name} ${value}`);
        items[index].labelUpdater(name);
        items[index].cylMaterial.color.setStyle(utils.makeHexColor(value));
        let ts = neutralScale + value/2.0;
        if (ts < 0.05) ts = 0.05;
        if (ts > 2.45) ts = 2.45;
        targetScale[index] = ts;
    }
}

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

    function render( time ) {

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

const goButton = document.getElementById("go");
const actionText = document.getElementById("action");

goButton.addEventListener("click", function() {
    const s = actionText.value;
    dbg(`go: ${s}`);
    if (s && s.length > 0) {
        // is a FEN with optional "moves ..." at the end?
        const fields = s.split(" ");
        if (fields.length >= 6 && fields[0].includes("/")) {
            comms.startEngine("fen " + s);
        } else if (s.startsWith("startpos")) {
            comms.startEngine(s);
        }
    }
});

comms.start(updateView);
main();
