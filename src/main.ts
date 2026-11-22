import './ui/styles.css';
import { BadaguanScene } from './scene/BadaguanScene';
import { getZoneAt, type ZoneInfo } from './scene/DistrictLayout';
import { CAMERA_PRESETS, INITIAL_VISTA } from './scene/Presets';
import { HudOverlay } from './ui/HudOverlay';

export interface BadaguanPublicState {
  ready: boolean;
  error: string | null;
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  activePreset: string | null;
  isTransitioning: boolean;
  isPointerLocked: boolean;
  controlsVisible: boolean;
  currentZone: ZoneInfo;
  frameCount: number;
  drawCalls: number;
}

type WindowWithBadaguanState = Window & {
  __BADAGUAN_STATE__?: BadaguanPublicState;
};

function createInitialPublicState(): BadaguanPublicState {
  return {
    ready: false,
    error: null,
    position: { ...INITIAL_VISTA.position },
    yaw: INITIAL_VISTA.yaw,
    pitch: INITIAL_VISTA.pitch,
    activePreset: null,
    isTransitioning: false,
    isPointerLocked: false,
    controlsVisible: false,
    currentZone: getZoneAt(
      INITIAL_VISTA.position.x,
      INITIAL_VISTA.position.z,
    ),
    frameCount: 0,
    drawCalls: 0,
  };
}

function bootstrapBadaguan(): void {
  const publicState = createInitialPublicState();
  (window as unknown as WindowWithBadaguanState).__BADAGUAN_STATE__ = publicState;

  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="scene-canvas"]');
  const hudRoot = document.getElementById('hud-root');

  if (!hudRoot) {
    publicState.error = 'HUD root element (#hud-root) not found.';
    return;
  }

  let badaguanScene: BadaguanScene | null = null;

  const hud = new HudOverlay(hudRoot, {
    presets: CAMERA_PRESETS,
    onSelectPreset: (oneBasedIndex) => {
      badaguanScene?.selectPreset(oneBasedIndex);
    },
    onControlsVisibilityChange: (visible) => {
      publicState.controlsVisible = visible;
    },
  });

  if (!canvas) {
    const msg = 'Canvas element ([data-testid="scene-canvas"]) not found.';
    publicState.error = msg;
    hud.showWebglFallback(msg);
    return;
  }

  try {
    badaguanScene = new BadaguanScene({
      canvas,
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      onPresetChange: () => {
        if (!badaguanScene) return;
        const snap = badaguanScene.getSnapshot();
        publicState.activePreset = snap.activePreset;
        publicState.isTransitioning = snap.isTransitioning;
        hud.update(snap.currentZone, snap.activePreset);
      },
      onControlsToggle: () => {
        hud.toggleControlsPanel();
      },
      onPointerLockChange: (locked) => {
        publicState.isPointerLocked = locked;
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'WebGL initialization failed';
    publicState.ready = false;
    publicState.error = message;
    hud.showWebglFallback(message);
    return;
  }

  let rafId = 0;
  let yieldTimerId = 0;
  let lastTimestamp = 0;
  let contextLost = false;
  let disposed = false;

  const cancelScheduledLoop = (): void => {
    if (rafId !== 0) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (yieldTimerId !== 0) {
      window.clearTimeout(yieldTimerId);
      yieldTimerId = 0;
    }
  };

  const scheduleNextFrame = (frameDt: number): void => {
    if (disposed || contextLost) return;
    if (frameDt > 0.06) {
      yieldTimerId = window.setTimeout(() => {
        yieldTimerId = 0;
        if (!disposed && !contextLost && rafId === 0) {
          rafId = window.requestAnimationFrame(renderLoop);
        }
      }, 24);
    } else {
      rafId = window.requestAnimationFrame(renderLoop);
    }
  };

  const syncTelemetry = (drawCalls: number): void => {
    if (!badaguanScene) return;
    const snap = badaguanScene.getSnapshot();
    publicState.position = { ...snap.position };
    publicState.yaw = snap.yaw;
    publicState.pitch = snap.pitch;
    publicState.activePreset = snap.activePreset;
    publicState.isTransitioning = snap.isTransitioning;
    publicState.isPointerLocked = snap.isPointerLocked;
    publicState.controlsVisible = hud.isControlsVisible();
    publicState.currentZone = snap.currentZone;
    publicState.drawCalls = drawCalls;
    hud.update(snap.currentZone, snap.activePreset);
  };

  const renderLoop = (timestamp: number): void => {
    rafId = 0;
    if (disposed || contextLost || !badaguanScene) return;

    const dt = lastTimestamp > 0 ? (timestamp - lastTimestamp) / 1000 : 1 / 60;
    lastTimestamp = timestamp;

    const { drawCalls } = badaguanScene.step(dt);
    publicState.frameCount += 1;
    syncTelemetry(drawCalls);

    if (!publicState.ready && publicState.frameCount >= 1) {
      publicState.ready = true;
      hud.hideLoading();
    }

    scheduleNextFrame(dt);
  };

  const handleResize = (): void => {
    badaguanScene?.resize(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio || 1,
    );
  };

  const handleContextLost = (event: Event): void => {
    event.preventDefault();
    contextLost = true;
    cancelScheduledLoop();
    publicState.error = 'WebGL context lost';
    hud.showWebglFallback('WebGL context lost');
  };

  const handleContextRestored = (): void => {
    contextLost = false;
    publicState.error = null;
    hud.hideWebglFallback();
    badaguanScene?.refreshShadows();
    lastTimestamp = 0;
    if (!disposed && rafId === 0 && yieldTimerId === 0) {
      rafId = window.requestAnimationFrame(renderLoop);
    }
  };

  const handleDispose = (): void => {
    if (disposed) return;
    disposed = true;
    cancelScheduledLoop();
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('beforeunload', handleDispose);
    canvas.removeEventListener('webglcontextlost', handleContextLost);
    canvas.removeEventListener('webglcontextrestored', handleContextRestored);
    hud.dispose();
    badaguanScene?.dispose();
    badaguanScene = null;
  };

  window.addEventListener('resize', handleResize);
  window.addEventListener('beforeunload', handleDispose);
  canvas.addEventListener('webglcontextlost', handleContextLost);
  canvas.addEventListener('webglcontextrestored', handleContextRestored);

  rafId = window.requestAnimationFrame(renderLoop);
}

bootstrapBadaguan();
