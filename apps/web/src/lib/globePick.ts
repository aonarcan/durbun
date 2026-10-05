import * as Cesium from 'cesium';

/**
 * The 3D point on the ground (terrain or photorealistic tiles) under a screen
 * position. Uses the depth buffer first, so it also works when the globe is
 * hidden behind Google's 3D tiles; falls back to the globe, then the ellipsoid.
 */
export function groundAt(viewer: Cesium.Viewer, windowPosition: Cesium.Cartesian2): Cesium.Cartesian3 | undefined {
  const { scene, camera } = viewer;
  if (scene.pickPositionSupported) {
    const p = scene.pickPosition(windowPosition);
    // Sky pixels give no position; a point far inside the Earth means a bad read.
    if (p && Cesium.Cartesian3.magnitude(p) > 6_000_000) return p;
  }
  const ray = camera.getPickRay(windowPosition);
  const onGlobe = ray && scene.globe.show ? scene.globe.pick(ray, scene) : undefined;
  return onGlobe ?? camera.pickEllipsoid(windowPosition) ?? undefined;
}

/** The ground point at the centre of the screen: what the camera orbits around. */
export function groundAtCentre(viewer: Cesium.Viewer): Cesium.Cartesian3 | undefined {
  const { canvas } = viewer;
  return groundAt(viewer, new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
}
