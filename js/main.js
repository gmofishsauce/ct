import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const canvas = document.querySelector( '#c' );
const renderer = new THREE.WebGLRenderer( { antialias: true, canvas } );
const scene = new THREE.Scene();
const height = 3; // XXX used in both actors() and rendering code

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

function actors() {
    const radius = 1.0;
    const radialSegments = 6;  
    const cylGeometry = new THREE.CylinderGeometry(radius, radius, height, radialSegments);

    function makeCylInstance( geometry, color, x, y, z ) {
		const material = new THREE.MeshPhongMaterial( { color } );
		const hexCyl = new THREE.Mesh( geometry, material );
		hexCyl.position.x = x;
		hexCyl.position.y = y;
		hexCyl.position.z = z;
		return hexCyl;
	}

    // Circle geometry matching the cylinder top (radius=1, 6 segments for hex alignment not needed)
    const labelGeometry = new THREE.CircleGeometry(1, 64); 

    function makeLabelInstance(geometry, text, xPos, yPos, zPos) {
        const size = 256; // keep it power of two
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = size;
        offscreenCanvas.height = size;
        const ctx = offscreenCanvas.getContext('2d');

        // Background transparent
        ctx.clearRect(0, 0, size, size);

        // Text styling
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '48px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(text, size / 2, size / 2);

        const texture = new THREE.CanvasTexture(offscreenCanvas);
        texture.needsUpdate = true;

        const labelMaterial = new THREE.MeshBasicMaterial({
            map: texture,
            color: 0xFFFFFF,
            transparent: true, // keep background transparent
            side: THREE.DoubleSide
        });

        const labelMesh = new THREE.Mesh(labelGeometry, labelMaterial);

        labelMesh.rotation.x = 0; // vertical; use -Math.PI / 2 to make flat
        labelMesh.position.x = xPos;
        labelMesh.position.y = yPos;
        labelMesh.position.z = zPos;
        return labelMesh;
    }

    const sqrt3 = Math.sqrt(3.0);
    const CYL = 0;
    const LAB = 1;

    function makeGroup(color, text, x, y, z) {
        const cyl = makeCylInstance(cylGeometry, color, 0, 0, 0);
        const lab = makeLabelInstance(labelGeometry, text, 0, height/2+0.1, 0);
        const group = new THREE.Group();
        group.add(cyl);
        group.add(lab);
        scene.add(group);
        group.position.set(x, y, z);
        return group;
    }

    const groups = [
        makeGroup(0x44aa88, "start", 0,        0, 0),
        makeGroup(0x8844aa, "e4",    sqrt3,    0, 0),
        makeGroup(0xaa8844, "d4",    -sqrt3,   0, 0),
        makeGroup(0x2266aa, "Nc3",   sqrt3/2,  0, 3/2),
        makeGroup(0x6622aa, "Nf3",   -sqrt3/2, 0, 3/2),
        makeGroup(0xaa6622, "c4",    sqrt3/2,  0, -3/2),
        makeGroup(0x886622, "b3",    -sqrt3/2, 0, -3/2),
    ];
    return groups;
}

let sent = false;

function main() {

    lights();
    const cam = camera();
    const groups = actors();

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
        groups.forEach((unused, ndx) => {
          targetScale[ndx] = 1.5 - Math.random(); // range 0.5..1.5
        });
      }

      // Every frame converges the bars on the targets by small steps
      groups.forEach((group, ndx) => {
        let diff = targetScale[ndx] - actualScale[ndx]
        if (Math.abs(diff) > 0.011) {
            if (diff > 0) {
              actualScale[ndx] += 0.01;
            } else {
              actualScale[ndx] -= 0.01;
            }
            group.children[0].scale.y = actualScale[ndx];
            group.children[0].position.y = height * (actualScale[ndx]/2) - height/2;
            group.children[1].position.y = height * (actualScale[ndx])   - height/2 + 0.01;
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

// And finally the non-animation part of the app

const worker = new Worker(new URL("worker.js", import.meta.url));

// Thanks for this Google
class StringMessageQueue {
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

document.getElementById("c").addEventListener('keydown', (e) => {
    dbg("key: " + e.keyCode); // TODO 
});

function parseInfo(strArray) {
    dbg("parseInfo()");
}

function parseOption(strArray) {
    dbg("parseOption()");
}

worker.onmessage = (e) => {
    let json = e.data;
    dbg("From worker: " + JSON.stringify(json));
    if (json.type === "stdout") {
        // yes, we want e.data.data.split()...
        let received = json.data.split(" ");
        if (received[0] === "info") {
            parseInfo(json.data);
        } else if (received[0] === "option") {
            parseOption(json.data);
        }
    }
    setStatus(json.status);
};

const outbound = new StringMessageQueue();

function doNet() {
    dbg("doNet() enter serverStatus " + serverStatus + " outbound.isEmpty() " + outbound.isEmpty());
    if (serverStatus == "ready" && !outbound.isEmpty()) {
        worker.postMessage({ type: "stdin", data: outbound.dequeue() });
    }
    setTimeout(doNet, 1100);
}

function connect() {
    if (serverStatus === "down") {
        dbg("connecting...");
        worker.postMessage({ type: "open", baseUrl: "http://localhost:8080" });
    }
    outbound.enqueue("uci\n");
    setTimeout(doNet, 1100);
}

setTimeout(connect, 1500);
main();
