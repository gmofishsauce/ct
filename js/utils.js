import * as THREE from 'three';

// === Position translation support ===

// See https://www.redblobgames.com/grids/hexagons/
// These are axial coordinates [q, r] with s derived.
// The order of the basisVectors is designed along with the 
// Stockfish responses to place taller "terrain" at the
// back right and lower terrain at the front left. We put
// 0, 0, 0 in the basisVectors as offset [0] because Stockfish
// index move traces from 1 to N.

const basisVectors = [
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

export function xyzPos(stockfishIndex, distance) {
    const hex = basisVectors[stockfishIndex];
    const x   = sqrt3*hex[0]  +  s3ov2*hex[1];
    const z   =                  t3ov2*hex[1];
    return [x*distance, 0, z*distance];
}

// === Color support - an empirically derived gradent. ===

// The argument is evaluation result, in pawns: 1.0 means "good for
// this player, they're leading by a pawn", and -1.0 means bad, etc.
// Pawn values can be up to 100 or so when mate is imminent, so we
// have to bound the argument. Returns array [r, g, b] for now.
function makeColor(pawns) {
    if (pawns > 5.0) pawns = 5.0;
    if (pawns < -5.0) pawns = -5.0;
    const ex = Math.exp(pawns);
    const sigmoid = 1.0 / (1.0+ex);

    // Sigmoid is now a value between 0 and 1. We want values > 0.5
    // tending toward green, < 0.5 tending toward red. We map 0.5 to
    // an 80, 80, 80 gray. Below 0.5, we increase red toward C0 in
    // 16 steps of 4 while decreasing green and blue by steps of 6
    // and 8, respectively. Above 0.5, we do the opposite. The end
    // values are C0, 20, 0 for values < 0.5 and 20, C0, 00 > 0.5.
    const stepsize = 0.5 / 16;
    let step = Math.abs(Math.round((sigmoid-0.5) / stepsize));
    if (step < 0) step = 0;
    if (step > 15) step = 15;

    if (pawns >= 0) {
        const red = 0x80 - 6*step;
        const green = 0x80 + 4*step;
        const blue = 0x80 - 8*step;
        return [red, green, blue];
    } else {
        const red = 0x80 + 4*step;
        const green = 0x80 - 6*step;
        const blue = 0x80 - 8*step;
        return [red, green, blue];
    }
}

const toHex = (c) => {
    const hex = Math.round(c).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
};

// TODO - would it be more efficient to return "0xNNNNNN"
// than "#NNNNNN" and use setColor() on the material rather
// than using setStyle()?
function rgbToHex(a) {
    return `#${toHex(a[0])}${toHex(a[1])}${toHex(a[2])}`;
}

export function makeHexColor(pawns) {
    return rgbToHex(makeColor(pawns));
}

/* === Mouse picking === */

export class PickHelper {
  constructor() {
    this.raycaster = new THREE.Raycaster();
    this.pickedObject = null;
    this.pickedObjectSavedColor = "#000000";
  }

  pick(x, y, scene, camera) {
    // restore the color if there is a picked object
    if (this.pickedObject) {
      this.pickedObject.material.color.setStyle(this.pickedObjectSavedColor);
      this.pickedObject = undefined;
    }

    // cast a ray through the frustum
    const normalizedPosition = { x, y };
    this.raycaster.setFromCamera(normalizedPosition, camera);
    // get the list of objects the ray intersected
    const intersectedObjects = this.raycaster.intersectObjects(scene.children);
    if (intersectedObjects.length) {
      // pick the first object. It's the closest one
      this.pickedObject = intersectedObjects[0].object;
      this.pickedObjectSavedColor = this.pickedObject.material.color.getStyle();
      this.pickedObject.material.color.setStyle("#FFFFFF");
    }
  }
}

