import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { NUMBER_LIFT, NUMBER_SIZE, applyQuat, faceUpQuaternion, facePlacements, faceUps, numberUps, percentileFaces, vertexUps, type FacePlacement } from "../renderer/diceMath.js";
import { cornerSpots, faceSpots, labelsFor, solidFor, trapezohedron, type DieKind, type LabelRole, type NumberSpot } from "../renderer/diceFx.js";

// Where the numbers sit on a die, and the promise that they are *on* it.
//
// **The bug this file exists for was visible for a day and invisible for a week before that.** Every
// digit was seated at `DIE_RADIUS * 1.06` along its face's normal — but that radius is the distance
// to a **corner** of these solids, not to a face. A d20's face plane is at 0.795 of it and a d4's at
// 0.333, so the numbers were drawn on an invisible sphere outside the die: floating a quarter of the
// radius clear of a d20's surface and three quarters of a d4's. Digits on the far side of a die
// showed as pale arcs around its outline, because a quad outside the silhouette is not hidden by the
// solid it belongs to.
//
// It was there from the first commit and nobody could see it, because at 40 pixels a die the gap was
// two pixels. Making the dice legible is what made the bug legible too — which is the argument for
// asserting it in arithmetic rather than trusting the next look at it.

/** Every die the tray can throw, including the one shape three.js does not ship. */
const KINDS: readonly DieKind[] = [4, 6, 8, 10, 12, 20];

function positionsOf(geometry: THREE.BufferGeometry): ArrayLike<number> {
  return geometry.getAttribute("position").array as ArrayLike<number>;
}

/** The die's own radius, read off the geometry rather than imported — it is the distance to a corner. */
function circumradius(positions: ArrayLike<number>): number {
  let far = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    far = Math.max(far, Math.hypot(positions[i]!, positions[i + 1]!, positions[i + 2]!));
  }
  return far;
}

/** How the renderer builds a die's number spots, for each kind. Mirrors buildFor. */
function spotsFor(kind: DieKind): { positions: ArrayLike<number>; spots: NumberSpot[] } {
  const positions = positionsOf(solidFor(kind));
  const ups = numberUps(kind === 4 ? vertexUps(positions) : faceUps(positions));
  const spots = kind === 4 ? cornerSpots(positions, ups) : faceSpots(ups, facePlacements(positions, ups));
  return { positions, spots };
}

/** The four corners of a spot's quad, in the die's own frame. */
function quadCorners(spot: NumberSpot): THREE.Vector3[] {
  const helper = new THREE.Vector3(Math.abs(spot.normal.y) > 0.9 ? 1 : 0, Math.abs(spot.normal.y) > 0.9 ? 0 : 1, 0);
  const right = helper.clone().cross(spot.normal).normalize();
  const up = spot.normal.clone().cross(right).normalize();
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) =>
    spot.centre.clone().addScaledVector(right, spot.half * sx!).addScaledVector(up, spot.half * sy!),
  );
}

describe("where a number sits", () => {
  it("puts no part of a number outside the die it is written on", () => {
    // **The bug, as arithmetic.** A convex solid is the intersection of its faces' half-spaces, so a
    // point is inside it exactly when it is behind every face plane. Every corner of every number
    // quad is checked against every face of its own die — allowing only the hair of clearance
    // NUMBER_LIFT asks for, which is what keeps the digit from fighting the face for depth.
    //
    // Under the old placement a d20's digits sat at 1.06 R against a face plane at 0.795 R. This
    // fails by 33% on that die and by 218% on a d4.
    for (const kind of KINDS) {
      const { positions, spots } = spotsFor(kind);
      const faces = faceUps(positions);
      const planes = facePlacements(positions, faces);
      const radius = circumradius(positions);
      for (const spot of spots) {
        for (const corner of quadCorners(spot)) {
          faces.forEach((face, f) => {
            const reach = corner.x * face[0] + corner.y * face[1] + corner.z * face[2];
            const allowed = planes[f]!.distance * NUMBER_LIFT + radius * 1e-6;
            expect(reach, `d${kind}: a number reaches ${(reach / radius).toFixed(3)} R past face ${f}`).toBeLessThanOrEqual(allowed);
          });
        }
      }
    }
  });

  it("seats every number on its own face, a hair proud and no more", () => {
    for (const kind of KINDS) {
      if (kind === 4) continue; // Read at a corner, so it has no face of its own — see below.
      const { positions, spots } = spotsFor(kind);
      const ups = numberUps(faceUps(positions));
      const planes = facePlacements(positions, ups);
      const radius = circumradius(positions);
      spots.forEach((spot, i) => {
        const seated = spot.centre.dot(spot.normal);
        expect(seated, `d${kind} face ${i}`).toBeCloseTo(planes[i]!.distance * NUMBER_LIFT, 6);
        // In the middle of the face, sideways — which is only the same as "on the normal axis" for
        // the five solids whose faces are symmetric about it. The d10's kites are not.
        const sideways = spot.centre.clone().addScaledVector(spot.normal, -seated);
        const middle = new THREE.Vector3(...planes[i]!.middle).addScaledVector(spot.normal, -planes[i]!.distance);
        expect(sideways.distanceTo(middle), `d${kind} face ${i} is off centre`).toBeLessThan(1e-6);
        // Proud enough to win a depth test, nowhere near the shell it used to be drawn on.
        const proud = seated - planes[i]!.distance;
        expect(proud, `d${kind} face ${i}`).toBeGreaterThan(0);
        expect(proud / radius, `d${kind} face ${i}`).toBeLessThan(0.02);
      });
    }
  });

  it("fits the quad inside the circle its face has room for", () => {
    for (const kind of KINDS) {
      if (kind === 4) continue;
      const { positions, spots } = spotsFor(kind);
      const ups = numberUps(faceUps(positions));
      const planes = facePlacements(positions, ups);
      spots.forEach((spot, i) => {
        // The quad is square and a d20's face is a triangle, so what has to fit is the *diagonal*.
        // Sized off the die instead of the face, a d20's corners reached 44% past its own edges.
        const reach = spot.half * Math.SQRT2;
        expect(reach, `d${kind} face ${i}`).toBeLessThanOrEqual(planes[i]!.extent + 1e-12);
        expect(reach / planes[i]!.extent, `d${kind} face ${i}`).toBeCloseTo(NUMBER_SIZE, 9);
      });
    }
  });
});

describe("measuring a face", () => {
  it("finds the plane distance and the inscribed radius of every solid", () => {
    // Against arithmetic rather than against a previous run, as shares of each solid's own
    // circumradius — the distance to a *corner*, which is the measurement the old placement mistook
    // for the distance to a face. A tetrahedron's faces are at a third of it; a cube's are at
    // 1/√3, because a cube's corner is √3 times as far out as its face.
    const expected: Record<number, readonly [number, number]> = {
      4: [1 / 3, 0.4714],
      6: [0.5774, 0.5774],
      8: [0.5774, 0.4082],
      12: [0.7947, 0.4911],
      20: [0.7947, 0.3035],
    };
    for (const [kind, [distance, extent]] of Object.entries(expected)) {
      const positions = positionsOf(solidFor(Number(kind) as DieKind));
      const radius = circumradius(positions);
      for (const place of facePlacements(positions, faceUps(positions))) {
        expect(place.distance / radius, `d${kind} distance`).toBeCloseTo(distance, 3);
        expect(place.extent / radius, `d${kind} extent`).toBeCloseTo(extent, 3);
      }
    }
  });

  it("reads the ten-sided die's kites, which are the one shape three does not ship", () => {
    const positions = positionsOf(trapezohedron(1));
    const ups = faceUps(positions);
    expect(ups.length).toBe(10);
    for (const place of facePlacements(positions, ups)) {
      expect(place.distance).toBeGreaterThan(0);
      // A kite with room on it. Zero here would mean the four corners were not being read as one
      // face — the exact failure the apex height is derived to avoid.
      expect(place.extent).toBeGreaterThan(0.1);
    }
  });

  it("says a corner has no face on it, rather than inventing a size", () => {
    // The d4 is read at its vertices, and a vertex is a point. Returning 0 is how this reports that
    // there is nothing to write on — which is what sends the d4 down the corner-marking path.
    const positions = positionsOf(solidFor(4));
    for (const place of facePlacements(positions, vertexUps(positions))) {
      expect(place.extent).toBe(0);
      expect(place.distance).toBeCloseTo(circumradius(positions), 6);
    }
  });

  it("follows the directions it is given, whatever order they are in", () => {
    // It is called *after* numberUps has reordered the faces into numbering order, so it has to key
    // off the direction rather than off any position in a list.
    const positions = positionsOf(solidFor(12));
    const ups = faceUps(positions);
    const shuffled = [...ups].reverse();
    const straight = facePlacements(positions, ups);
    const backwards = facePlacements(positions, shuffled);
    expect(backwards).toEqual([...straight].reverse());
  });
});

describe("the four-sided die", () => {
  it("writes each number three times, once on every face that meets its corner", () => {
    // What a real d4 does, and it is not decoration: a tetrahedron resting on a face shows you a
    // corner, not a face, so the number has to be readable from whichever side you are on.
    const { spots } = spotsFor(4);
    expect(spots.length).toBe(12);
    for (let number = 0; number < 4; number += 1) {
      expect(spots.filter((spot) => spot.index === number).length, `number ${number}`).toBe(3);
    }
  });

  it("puts every mark on a face, not floating off the point", () => {
    const { positions, spots } = spotsFor(4);
    const faces = faceUps(positions);
    const planes = facePlacements(positions, faces);
    for (const spot of spots) {
      // Each mark lies on exactly one of the four faces, seated on that plane.
      const on = faces.filter((face, f) => {
        const seated = spot.centre.x * face[0] + spot.centre.y * face[1] + spot.centre.z * face[2];
        return Math.abs(seated - planes[f]!.distance) < planes[f]!.distance * 0.05;
      });
      expect(on.length).toBe(1);
    }
  });

  it("keeps the three marks on a face clear of each other", () => {
    const { spots } = spotsFor(4);
    for (let i = 0; i < spots.length; i += 1) {
      for (let j = i + 1; j < spots.length; j += 1) {
        const gap = spots[i]!.centre.distanceTo(spots[j]!.centre);
        // Two quads whose half-widths overlap would be two digits printed over each other.
        expect(gap, `marks ${i} and ${j}`).toBeGreaterThan(spots[i]!.half + spots[j]!.half);
      }
    }
  });
});

describe("what the die actually shows", () => {
  // **The gap the d10 bug lived in.** Everything above proves the numbers are *on* the solid, and
  // `tests/diceMath.test.ts` proves the chosen direction ends up pointing *up*. Neither one asks the
  // only question a player cares about: is the number now facing me the number the panel printed?
  //
  // Nothing in this repo asked it, and a d10 spent its whole life showing one less than it rolled.

  /** Roll `v` of `kind` should read as this. A ten-sided die draws its ten as a zero. */
  function expected(kind: DieKind, roll: number): string {
    return kind === 10 ? `${roll % 10}` : `${roll}`;
  }

  /**
   * The glyph a player sees, found the long way round.
   *
   * **Deliberately rediscovers which face is up** rather than assuming it is the one that was asked
   * for. Turning the die by its landing quaternion and then looking to see what ended up on top is
   * the chain that actually runs, and a mis-numbering anywhere along it comes out here.
   */
  function shows(kind: DieKind, role: LabelRole, roll: number, yaw: number): string {
    const positions = positionsOf(solidFor(kind));
    const ups = numberUps(kind === 4 ? vertexUps(positions) : faceUps(positions));
    const turn = faceUpQuaternion(ups[roll - 1]!, yaw);
    let best = -1;
    let highest = -Infinity;
    ups.forEach((up, i) => {
      const lifted = applyQuat(up, turn)[1];
      if (lifted > highest) {
        highest = lifted;
        best = i;
      }
    });
    expect(highest, `${kind} face ${roll} did not come up at all`).toBeGreaterThan(0.999);
    return labelsFor(kind, role)[best]!;
  }

  it("shows the number that was rolled, on every face of every die", () => {
    for (const kind of KINDS) {
      for (let roll = 1; roll <= kind; roll += 1) {
        for (const yaw of [0, 1.1, 2.9, -0.7]) {
          expect(shows(kind, "plain", roll, yaw), `d${kind} rolled ${roll}`).toBe(expected(kind, roll));
        }
      }
    }
  });

  it("draws a ten-sided die's ten as a zero", () => {
    expect(shows(10, "plain", 10, 0.3)).toBe("0");
    expect(shows(10, "plain", 9, 0.3)).toBe("9");
    expect(shows(10, "plain", 1, 0.3)).toBe("1");
  });

  it("puts opposite faces on either side of one more than the count, ten-sided die included", () => {
    // The d10 is the one solid the numbering tests in diceMath skip, because SOLIDS is built from
    // three's primitives and a trapezohedron is not one. Read with the zero standing for ten, its
    // opposite faces sum to eleven like everything else — so a zero sits opposite a one.
    const positions = positionsOf(solidFor(10));
    const ups = numberUps(faceUps(positions));
    const value = (label: string) => (label === "0" ? 10 : Number(label));
    const labels = labelsFor(10, "plain");
    for (let i = 0; i < ups.length; i += 1) {
      const opposite = ups.findIndex((up) => up[0] * ups[i]![0] + up[1] * ups[i]![1] + up[2] * ups[i]![2] < -0.999);
      expect(opposite, `face ${labels[i]} has no opposite`).toBeGreaterThanOrEqual(0);
      expect(value(labels[i]!) + value(labels[opposite]!), `${labels[i]} against ${labels[opposite]}`).toBe(11);
    }
  });

  it("reads every percentile roll back as itself", () => {
    // Two dice, one marked in tens, and the pair has to say what the engine rolled — including a
    // hundred, which is the one roll where neither die shows what it looks like it shows.
    const tens = labelsFor(10, "tens");
    const units = labelsFor(10, "units");
    for (let rolled = 1; rolled <= 100; rolled += 1) {
      const [t, u] = percentileFaces(rolled);
      const read = Number(tens[t - 1]!) + Number(units[u - 1]!);
      expect(read === 0 ? 100 : read, `rolled ${rolled}`).toBe(rolled);
    }
  });

  it("gives every role a full set of distinct labels", () => {
    for (const role of ["plain", "tens", "units"] as LabelRole[]) {
      const labels = labelsFor(10, role);
      expect(labels.length, role).toBe(10);
      expect(new Set(labels).size, role).toBe(10);
    }
  });
});

describe("which way up a number sits", () => {
  // **The third bug in this seam**, after the digits floating outside the solid and the d10 reading
  // one low. The quad's rotation came from world space — an axis picked as whichever of X or Y was
  // least parallel to the face — under a comment claiming a number has no up on a die you see from
  // every side. It has one relative to *its own face*, and measured across a single symmetry step
  // the old rule left a d20 spread over the whole 120 degrees, a d8 over 60, and a d10's ten kites
  // split exactly between 0 and 180: five upright, five upside down.

  interface Face {
    normal: THREE.Vector3;
    middle: THREE.Vector3;
    axis: THREE.Vector3;
    /** Its corners, in the die's own frame. */
    ring: THREE.Vector3[];
  }

  function facesOf(kind: DieKind): Face[] {
    const positions = positionsOf(solidFor(kind));
    const ups = faceUps(positions);
    const places = facePlacements(positions, ups);
    return ups.map((up, f) => {
      const place = places[f]!;
      const normal = new THREE.Vector3(up[0], up[1], up[2]);
      const grip = Math.max(1e-6, Math.abs(place.distance) * 1e-3);
      const ring: THREE.Vector3[] = [];
      for (let i = 0; i + 2 < positions.length; i += 3) {
        const v = new THREE.Vector3(positions[i]!, positions[i + 1]!, positions[i + 2]!);
        if (Math.abs(v.dot(normal) - place.distance) > grip) continue;
        if (!ring.some((seen) => seen.distanceTo(v) < grip)) ring.push(v);
      }
      // **Sorted around the face before anything measures its edges.** They arrive in whatever order
      // the triangles were wound, so consecutive entries are sometimes diagonally opposite corners —
      // and the midpoint of a diagonal sits at the face's centre, which is not an edge of anything.
      const middle = new THREE.Vector3(...place.middle);
      const across = ring[0]!.clone().sub(middle).projectOnPlane(normal).normalize();
      const other = new THREE.Vector3().crossVectors(normal, across);
      const around = (v: THREE.Vector3) => {
        const arm = v.clone().sub(middle);
        return Math.atan2(arm.dot(other), arm.dot(across));
      };
      ring.sort((u, v) => around(u) - around(v));
      return { normal, middle, axis: new THREE.Vector3(...place.axis), ring };
    });
  }

  it("gives every face an axis that is a real symmetry of its own outline", () => {
    // The property the search claims to have found, checked rather than trusted: mirroring the
    // corners across the axis has to leave the face exactly where it was.
    for (const kind of KINDS) {
      for (const [f, face] of facesOf(kind).entries()) {
        if (face.ring.length < 3) continue;
        expect(face.axis.length(), `d${kind} face ${f}`).toBeCloseTo(1, 6);
        expect(Math.abs(face.axis.dot(face.normal)), `d${kind} face ${f} axis leaves the face`).toBeLessThan(1e-6);
        const sideways = new THREE.Vector3().crossVectors(face.normal, face.axis);
        const scale = Math.max(...face.ring.map((c) => c.distanceTo(face.middle)));
        for (const corner of face.ring) {
          const arm = corner.clone().sub(face.middle);
          const mirrored = arm.clone().addScaledVector(sideways, -2 * arm.dot(sideways));
          const found = face.ring.some((other) => other.clone().sub(face.middle).distanceTo(mirrored) < scale * 1e-3);
          expect(found, `d${kind} face ${f}: mirroring a corner left the outline`).toBe(true);
        }
      }
    }
  });

  it("stands every number on its face the same way as every other", () => {
    // **The defect, as arithmetic.** Measured within one step of the face's own rotational symmetry,
    // the spread across a die's faces has to be nothing — every face carrying its number at the same
    // angle to its own outline, not at whatever angle its normal happened to give.
    for (const kind of KINDS) {
      const faces = facesOf(kind).filter((face) => face.ring.length >= 3);
      // **Measured against the face's own edges, not against a fixed step.** Folding by 360/n
      // assumes the face has n-fold rotational symmetry, which a kite does not have at all — that
      // measure reported 62 degrees of spread on a d10 whose faces were in fact all identical.
      // How far the axis sits from the nearest edge midpoint is a property of the face's shape, so
      // congruent faces have to agree on it however they are turned.
      const angles = faces.map((face) => {
        let nearest = 180;
        for (let i = 0; i < face.ring.length; i += 1) {
          const a = face.ring[i]!;
          const b = face.ring[(i + 1) % face.ring.length]!;
          const toEdge = a.clone().add(b).multiplyScalar(0.5).sub(face.middle).projectOnPlane(face.normal).normalize();
          nearest = Math.min(nearest, (Math.acos(Math.max(-1, Math.min(1, toEdge.dot(face.axis)))) * 180) / Math.PI);
        }
        return nearest;
      });
      const spread = Math.max(...angles) - Math.min(...angles);
      expect(spread, `d${kind} carries its numbers at ${spread.toFixed(0)} degrees of spread`).toBeLessThan(1);
    }
  });

  it("points the axis at the narrower end of a tapered face", () => {
    // A d10's kite is the only face here with a narrow end. The number's top belongs at the point,
    // so that it stands on the wide part rather than hanging off the tip.
    for (const face of facesOf(10)) {
      const along = face.ring.map((corner) => corner.clone().sub(face.middle).dot(face.axis));
      // The point is the corner furthest out along the axis; the blunt end is nearer than it.
      expect(Math.max(...along)).toBeGreaterThan(Math.abs(Math.min(...along)));
    }
  });

  it("keeps a cube's numbers square to its edges", () => {
    // The one die the old rule got right, and so the one to check for a regression. An axis pointing
    // at a corner instead of an edge would set every digit on a d6 at forty-five degrees.
    for (const face of facesOf(6)) {
      const ontoCorner = Math.max(...face.ring.map((c) => Math.abs(c.clone().sub(face.middle).normalize().dot(face.axis))));
      // A square's corners sit at 45 degrees to its edge normals, so an edge-aligned axis never
      // falls more than cos 45 onto one.
      expect(ontoCorner).toBeLessThan(0.8);
    }
  });

  it("moves the middle only where the face is not regular", () => {
    // The area centre and the corner average agree on every regular face, so nothing but the d10's
    // kite may shift — the change has to be invisible on the other five dice.
    for (const kind of [4, 6, 8, 12, 20] as DieKind[]) {
      const positions = positionsOf(solidFor(kind));
      const radius = circumradius(positions);
      for (const place of facePlacements(positions, faceUps(positions))) {
        // On a regular face the middle sits on the normal, so its distance from the die's centre is
        // exactly the face distance.
        expect(Math.abs(Math.hypot(...place.middle) - place.distance) / radius, `d${kind}`).toBeLessThan(1e-3);
      }
    }
  });
});
