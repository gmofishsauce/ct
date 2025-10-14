import * as THREE from "three";

export function dbg(msg) {
  console.log(msg);
}

export function dbobj(obj) {
  dbg(`=== Properties of ${obj && obj.constructor ? obj.constructor.name : typeof obj}: ===`);
  try {
    console.log(JSON.stringify(obj, Object.keys(obj || {}), 2));
  } catch (err) { // not serializable
    for (let prop in obj) {
    console.log(`  ${prop}: ${obj[prop]}`);
    }
  }
}

// === Position translation support ===

const sqrt3 = Math.sqrt(3);
const s3ov2 = sqrt3 / 2;
const t3ov2 = 3 / 2;

export function xyzPos(qrVec) {
  const x = sqrt3 * qrVec[0] + s3ov2 * qrVec[1];
  const z = t3ov2 * qrVec[1];
  return [x, 0.0, z];
}

// === Color support - an empirically derived gradent. ===

// The argument is evaluation result, in pawns: 1.0 means "good for
// this player, they're leading by a pawn", and -1.0 means bad, etc.
// Pawn values can be up to 100 or so when mate is imminent, so we
// have to bound the argument. Returns array [r, g, b] for now.
function makeColor(pawns) {
  if (pawns > 5.0) pawns = 5.0;
  if (pawns < -5.0) pawns = -5.0;
  // correct logistic: sigmoid(x) = 1 / (1 + exp(-x))
  const ex = Math.exp(-pawns);
  const sigmoid = 1.0 / (1.0 + ex);

  const stepsize = 0.5 / 16;
  let step = Math.abs(Math.round((sigmoid - 0.5) / stepsize));
  if (step < 0) step = 0;
  if (step > 15) step = 15;

  // branch based on sigmoid (0.5 is neutral)
  if (sigmoid >= 0.5) {
    const red = 0x80 - 6 * step;
    const green = 0x80 + 4 * step;
    const blue = 0x80 - 8 * step;
    return [red, green, blue];
  } else {
    const red = 0x80 + 4 * step;
    const green = 0x80 - 6 * step;
    const blue = 0x80 - 8 * step;
    return [red, green, blue];
  }
}

const toHex = (c) => {
  // clamp to [0,255], round, then hex
  const v = Math.round(Math.max(0, Math.min(255, c)));
  const hex = v.toString(16);
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
    let picked = null;
    for (let drill of intersectedObjects) {
      // The list of intersected objects drills inward when one object obscures another.
      // The cylinder mesh can be obscured by the label mesh (it's not necessarily [0]).
      // Intersected objects are often but not always triangles. Their mesh is in .object.
      if (drill.name == "CYL") {
        picked = drill;
      } else if (drill.object && drill.object.name == "CYL") {
        picked = drill.object;
      }
      if (picked != null) {
        this.pickedObject = picked;
        this.pickedObjectSavedColor =
          this.pickedObject.material.color.getStyle();
        this.pickedObject.material.color.setStyle("#FFFFFF");
        break;
      }
    }

    // Return the picked object
    if (picked == null) {
      return null;
    }
    if (picked.name == "CYL" && picked.parent && picked.parent.name == "GROUP") {
      return picked.parent.owner;
    }
    dbg("unexpected non-null picked object:");
    dbobj(picked);
    return null;
  }
}
