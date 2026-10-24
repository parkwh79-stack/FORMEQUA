/** First-person floor navigation. Metres, x/z world coordinates; no renderer dependency. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AtelierInteriorWalk = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function canStand(plan, x, z, margin = .22) {
    if (!plan || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    const b = plan.bounds;
    if (x < b.minX + margin || x > b.maxX - margin || z < b.minZ + margin || z > b.maxZ - margin) return false;
    if ([...plan.cores, ...plan.voids, ...(plan.obstacles || [])].some(r => x > r.minX - margin && x < r.maxX + margin && z > r.minZ - margin && z < r.maxZ + margin)) return false;
    if (plan.furniture.some(item => {
      // The same rotation used to draw each furniture item also applies to its obstacle.
      const angle = item.rotationY || 0, dx = x - item.x, dz = z - item.z;
      const localX = Math.cos(angle) * dx - Math.sin(angle) * dz;
      const localZ = Math.sin(angle) * dx + Math.cos(angle) * dz;
      return Math.abs(localX) < item.width / 2 + margin && Math.abs(localZ) < item.depth / 2 + margin;
    })) return false;
    return !plan.walls.some(wall => {
      const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1, lengthSq = dx * dx + dz * dz;
      const t = clamp(((x - wall.x1) * dx + (z - wall.z1) * dz) / (lengthSq || 1), 0, 1);
      return Math.hypot(x - wall.x1 - t * dx, z - wall.z1 - t * dz) < margin + (wall.thickness || .12) / 2;
    });
  }

  function move(plan, position, movement, margin = .22) {
    let x = position.x, z = position.z, travelled = 0;
    const length = Math.hypot(movement.x, movement.z);
    if (!Number.isFinite(length) || !length) return { x, z, travelled };
    // Sweep along the whole motion, including a fast wheel/Shift event. A thin wall
    // must not disappear simply because both end points happen to be clear.
    const steps = Math.max(1, Math.ceil(length / .08));
    const dx = movement.x / steps, dz = movement.z / steps;
    for (let i = 0; i < steps; i++) {
      const oldX = x, oldZ = z;
      if (canStand(plan, x + dx, z, margin)) x += dx;
      if (canStand(plan, x, z + dz, margin)) z += dz;
      travelled += Math.hypot(x - oldX, z - oldZ);
    }
    return { x, z, travelled };
  }

  function direction(yaw, forward, right, distance) {
    const length = Math.hypot(forward, right);
    if (!length) return { x: 0, z: 0 };
    return {
      x: (Math.sin(yaw) * forward + Math.cos(yaw) * right) / length * distance,
      z: (-Math.cos(yaw) * forward + Math.sin(yaw) * right) / length * distance
    };
  }

  function wheelDistance(delta, deltaMode = 0) {
    // Browser pixel, line and page wheel events express different units.
    const pixels = delta * (deltaMode === 1 ? 32 : deltaMode === 2 ? 640 : 1);
    return clamp(-pixels * .012, -2.4, 2.4);
  }

  function gaitOffset(distance) {
    // One gentle 12 mm rise/fall per step, tied to distance rather than frame rate.
    return Math.sin(distance * Math.PI * 2 / .72) * .012;
  }

  return Object.freeze({ canStand, move, direction, wheelDistance, gaitOffset });
});
