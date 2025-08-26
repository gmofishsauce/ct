import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

function main() {

    const canvas = document.querySelector( '#c' );
    const renderer = new THREE.WebGLRenderer( { antialias: true, canvas } );
    const scene = new THREE.Scene();

    const fov = 60;
    const aspect = 2; // the canvas default
    const near = 0.1;
    const far = 25;
    const camera = new THREE.PerspectiveCamera( fov, aspect, near, far );
    camera.position.z = 15;

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 2, 0);
    controls.update();

    const lightColor = 0xFFFFFF;
    let lightIntensity = 2;
    const ambientLight = new THREE.AmbientLight(lightColor, lightIntensity);
    scene.add(ambientLight);

    lightIntensity = 3;
    const directionalLight = new THREE.DirectionalLight(lightColor, 3);
    directionalLight.position.set(-1, 2, 4);
    scene.add(directionalLight);

    const radius = 1.0;
    const height = 5;  
    const radialSegments = 6;  
    const hexCyl = new THREE.CylinderGeometry(radius, radius, height, radialSegments);

    function makeCylInstance( geometry, color, x, y, z ) {
		const material = new THREE.MeshPhongMaterial( { color } );
		const hexCyl = new THREE.Mesh( geometry, material );
		scene.add( hexCyl );
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

        // Position the label just above the cylinder top
        labelMesh.rotation.x = 0; // vertical; use -Math.PI / 2 to make flat
        labelMesh.position.x = xPos;
        labelMesh.position.y = yPos;
        labelMesh.position.z = zPos;
        scene.add(labelMesh);
        return labelMesh;
    }

    const sqrt3 = Math.sqrt(3.0);

    const hexCyls = [
        makeCylInstance(hexCyl, 0x44aa88, 0, 0, 0),
        makeCylInstance(hexCyl, 0x8844aa, sqrt3, 0, 0),
        makeCylInstance(hexCyl, 0xaa8844, -sqrt3, 0, 0),
        makeCylInstance(hexCyl, 0x2266aa, sqrt3/2.0, 0, 3/2),
        makeCylInstance(hexCyl, 0x6622aa, -sqrt3/2, 0, 3/2),
        makeCylInstance(hexCyl, 0xaa6622, sqrt3/2, 0, -3/2),
        makeCylInstance(hexCyl, 0x886622, -sqrt3/2, 0, -3/2),
    ];

    const labels = [
        makeLabelInstance(labelGeometry, "start", 0, 5, 0),
        makeLabelInstance(labelGeometry, "e4", sqrt3, 5, 0),
        makeLabelInstance(labelGeometry, "d4", -sqrt3, 5, 0),
        makeLabelInstance(labelGeometry, "Nc3", sqrt3/2.0, 5, 3/2),
        makeLabelInstance(labelGeometry, "Nf3", -sqrt3/2, 5, 3/2),
        makeLabelInstance(labelGeometry, "c4", sqrt3/2, 5, -3/2),
        makeLabelInstance(labelGeometry, "b3", -sqrt3/2, 5, -3/2),
    ];

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
        hexCyls.forEach((hexCyl, ndx) => {
          targetScale[ndx] = 1.5 - Math.random();
        });
      }

      // Every frame converges the bars on the targets by small steps
      hexCyls.forEach((hexCyl, ndx) => {
        let diff = targetScale[ndx] - actualScale[ndx]
        if (Math.abs(diff) > 0.011) {
            if (diff > 0) {
              actualScale[ndx] += 0.01;
            } else {
              actualScale[ndx] -= 0.01;
            }
            hexCyls[ndx].scale.y = actualScale[ndx];
            hexCyls[ndx].position.y = height * (actualScale[ndx]/2) - height/2;
            labels[ndx].position.y = 3+(height * (actualScale[ndx]/2) - height/2);
        }
      });

      if (resizeRendererToDisplaySize(renderer)) {
        const canvas = renderer.domElement;
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
      }

      renderer.render( scene, camera );
      requestAnimationFrame( render );
    }

    requestAnimationFrame( render );
}

main();
