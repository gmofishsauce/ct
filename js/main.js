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
    const shape = new THREE.CylinderGeometry(radius, radius, height, radialSegments);

	function makeInstance( geometry, color, x, y, z ) {
		const material = new THREE.MeshPhongMaterial( { color } );
		const shape = new THREE.Mesh( geometry, material );
		scene.add( shape );
		shape.position.x = x;
		shape.position.y = y;
		shape.position.z = z;
		return shape;
	}

    const sqrt3 = Math.sqrt(3.0);

    const shapes = [
      makeInstance(shape, 0x44aa88, 0, 0, 0),
      makeInstance(shape, 0x8844aa, sqrt3, 0, 0),
      makeInstance(shape, 0xaa8844, -sqrt3, 0, 0),
      makeInstance(shape, 0x2266aa, sqrt3/2.0, 0, 3/2),
      makeInstance(shape, 0x6622aa, -sqrt3/2, 0, 3/2),
      makeInstance(shape, 0xaa6622, sqrt3/2, 0, -3/2),
      makeInstance(shape, 0x886622, -sqrt3/2, 0, -3/2),
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
        shapes.forEach((shape, ndx) => {
          targetScale[ndx] = 1.5 - Math.random();
        });
      }

      // Every frame converges the bars on the targets by small steps
      shapes.forEach((shape, ndx) => {
        let diff = targetScale[ndx] - actualScale[ndx]
        if (Math.abs(diff) > 0.011) {
            if (diff > 0) {
              actualScale[ndx] += 0.01;
            } else {
              actualScale[ndx] -= 0.01;
            }
            shapes[ndx].scale.y = actualScale[ndx];
            shapes[ndx].position.y = height * (actualScale[ndx]/2)
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
