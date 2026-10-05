import * as Cesium from 'cesium';
import { useEffect, useState } from 'react';
import { t } from '../i18n.ts';
import { groundAtCentre } from '../lib/globePick.ts';
import { useUi, type Buildings3d } from '../state.ts';

const MIN_PITCH = Cesium.Math.toRadians(-90);
const MAX_PITCH = Cesium.Math.toRadians(-8);
const HINT_KEY = 'durbun.hint3d.v1';

interface OrbitChange {
  heading?: number;
  pitch?: number;
  dHeading?: number;
  dPitch?: number;
  rangeFactor?: number;
}

/** Moves the camera around the centre point: rotate, tilt or zoom, with a short animation. */
export function orbit(viewer: Cesium.Viewer, change: OrbitChange): void {
  const target = groundAtCentre(viewer);
  const { camera } = viewer;
  if (!target) {
    if (change.rangeFactor) camera.zoomIn((1 - change.rangeFactor) * camera.positionCartographic.height);
    return;
  }
  const range = Cesium.Cartesian3.distance(camera.positionWC, target) * (change.rangeFactor ?? 1);
  const heading = change.heading ?? camera.heading + (change.dHeading ?? 0);
  const pitch = Cesium.Math.clamp(change.pitch ?? camera.pitch + (change.dPitch ?? 0), MIN_PITCH, MAX_PITCH);
  camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 0), {
    offset: new Cesium.HeadingPitchRange(heading, pitch, Math.max(range, 50)),
    duration: 0.35,
  });
}

/**
 * Mouse and touch the way the 2D map works: left drag moves, right drag
 * rotates and tilts, the wheel zooms, two fingers tilt on touch screens.
 */
export function setUpMouse(viewer: Cesium.Viewer): void {
  const ssc = viewer.scene.screenSpaceCameraController;
  const { CameraEventType: E, KeyboardEventModifier: K } = Cesium;
  ssc.zoomEventTypes = [E.WHEEL, E.PINCH];
  ssc.tiltEventTypes = [
    E.RIGHT_DRAG,
    E.MIDDLE_DRAG,
    E.PINCH,
    { eventType: E.LEFT_DRAG, modifier: K.CTRL },
    { eventType: E.LEFT_DRAG, modifier: K.SHIFT },
  ];
  // Keep the browser's menu from opening on right drag.
  viewer.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

function readHintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/** On-screen buttons for the 3D camera, plus a one-time hint about the mouse. */
export function GlobeControls({ viewer, buildingsAvailable }: { viewer: Cesium.Viewer; buildingsAvailable: boolean }) {
  const lang = useUi((s) => s.lang);
  const buildings3d = useUi((s) => s.buildings3d);
  const setBuildings3d = useUi((s) => s.setBuildings3d);
  const buildingOptions: { id: Buildings3d; label: string }[] = [
    { id: 'osm', label: t(lang, 'buildingsOsm') },
    { id: 'google', label: t(lang, 'buildingsGoogle') },
    { id: 'off', label: t(lang, 'buildingsOff') },
  ];
  const [heading, setHeading] = useState(0);
  const [hintOpen, setHintOpen] = useState(() => !readHintDismissed());

  useEffect(() => {
    viewer.camera.percentageChanged = 0.01;
    const update = () => setHeading(Cesium.Math.toDegrees(viewer.camera.heading));
    update();
    return viewer.camera.changed.addEventListener(update);
  }, [viewer]);

  const step = Cesium.Math.toRadians(15);
  const turn = Cesium.Math.toRadians(30);
  const buttons: { key: string; label: string; icon: string; run: () => void }[] = [
    { key: 'in', label: t(lang, 'zoomIn'), icon: '+', run: () => orbit(viewer, { rangeFactor: 0.5 }) },
    { key: 'out', label: t(lang, 'zoomOut'), icon: '−', run: () => orbit(viewer, { rangeFactor: 2 }) },
    { key: 'tilt', label: t(lang, 'tiltUp'), icon: '⤢', run: () => orbit(viewer, { dPitch: step }) },
    { key: 'top', label: t(lang, 'topDown'), icon: '⊙', run: () => orbit(viewer, { pitch: MIN_PITCH }) },
    { key: 'left', label: t(lang, 'rotateLeft'), icon: '⟲', run: () => orbit(viewer, { dHeading: -turn }) },
    { key: 'right', label: t(lang, 'rotateRight'), icon: '⟳', run: () => orbit(viewer, { dHeading: turn }) },
  ];

  const dismiss = () => {
    setHintOpen(false);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // Not saved: the hint shows again next time.
    }
  };

  return (
    <>
      <div className="globe-controls" role="toolbar" aria-label="3B">
        <button
          type="button"
          className="compass"
          title={t(lang, 'resetNorth')}
          aria-label={t(lang, 'resetNorth')}
          onClick={() => orbit(viewer, { heading: 0 })}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" style={{ transform: `rotate(${-heading}deg)` }} aria-hidden="true">
            <path d="M12 2 L16 12 L12 10.5 L8 12 Z" fill="#d62728" />
            <path d="M12 22 L8 12 L12 13.5 L16 12 Z" fill="#9aa3b5" />
          </svg>
        </button>
        {buttons.map((b) => (
          <button key={b.key} type="button" title={b.label} aria-label={b.label} onClick={b.run}>
            {b.icon}
          </button>
        ))}
      </div>
      {buildingsAvailable && (
        <div className="globe-buildings">
          <span>{t(lang, 'buildings3d')}</span>
          <div className="segmented small" role="radiogroup" aria-label={t(lang, 'buildings3d')}>
            {buildingOptions.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={buildings3d === o.id}
                className={buildings3d === o.id ? 'active' : ''}
                onClick={() => setBuildings3d(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {hintOpen && (
        <div className="globe-help" role="note">
          <span>{t(lang, 'globeHelp')}</span>
          <button type="button" aria-label={t(lang, 'close')} onClick={dismiss}>
            ✕
          </button>
        </div>
      )}
    </>
  );
}
