import * as THREE from 'three';
import { NavigationController, type NavigationSnapshot } from '../controls/NavigationController';
import { createAtmosphere, type AtmosphereRig } from './Atmosphere';
import { buildArchitecture, type ArchitectureBuildResult } from './Architecture';
import type { ColliderBox } from './DistrictLayout';
import { CAMERA_PRESETS, INITIAL_VISTA } from './Presets';
import { createProceduralMaterials, type ProceduralMaterialSet } from './ProceduralMaterials';
import { buildTerrainAndRoads, type TerrainAndRoadsResult } from './TerrainAndRoads';
import { buildVegetationAndProps, type VegetationBuildResult } from './VegetationAndProps';

export interface BadaguanSceneOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  devicePixelRatio?: number;
  onPresetChange?: (presetId: string | null) => void;
  onControlsToggle?: () => void;
  onPointerLockChange?: (locked: boolean) => void;
  createRenderer?: (canvas: HTMLCanvasElement) => THREE.WebGLRenderer;
  createMaterials?: (maxAnisotropy: number) => ProceduralMaterialSet;
}

export interface BadaguanFrameResult {
  snapshot: NavigationSnapshot;
  drawCalls: number;
}

function isSoftwareWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    const gl =
      (probe.getContext('webgl2') as WebGL2RenderingContext | null) ??
      (probe.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = String(
      (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null) ??
        gl.getParameter(gl.RENDERER) ??
        '',
    );
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render/i.test(
      rendererName,
    );
  } catch {
    return false;
  }
}

function sanitizeDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(1, value) : 1;
}

function sanitizePixelRatio(dpr: number | undefined, softwareMode: boolean): number {
  const valid = dpr !== undefined && Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return softwareMode ? Math.min(valid, 0.70) : Math.min(valid, 2);
}

function defaultCreateRenderer(
  canvas: HTMLCanvasElement,
  softwareMode: boolean,
): THREE.WebGLRenderer {
  return new THREE.WebGLRenderer({
    canvas,
    antialias: !softwareMode,
    powerPreference: 'high-performance',
  });
}

export class BadaguanScene {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly colliders: readonly ColliderBox[];
  public readonly navigation: NavigationController;

  private readonly atmosphere: AtmosphereRig;
  private readonly materials: ProceduralMaterialSet;
  private readonly terrain: TerrainAndRoadsResult;
  private readonly architecture: ArchitectureBuildResult;
  private readonly vegetation: VegetationBuildResult;
  private readonly softwareMode: boolean;

  private elapsedTime = 0;
  private disposed = false;

  constructor(options: BadaguanSceneOptions) {
    this.softwareMode = options.createRenderer ? false : isSoftwareWebGL();
    this.renderer = options.createRenderer
      ? options.createRenderer(options.canvas)
      : defaultCreateRenderer(options.canvas, this.softwareMode);

    const safeWidth = sanitizeDimension(options.width);
    const safeHeight = sanitizeDimension(options.height);
    const safeDpr = sanitizePixelRatio(options.devicePixelRatio, this.softwareMode);

    this.renderer.setPixelRatio(safeDpr);
    this.renderer.setSize(safeWidth, safeHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, safeWidth / safeHeight, 0.2, 2200);
    this.camera.rotation.order = 'YXZ';

    const maxAnisotropy = Math.min(
      this.softwareMode ? 1 : 8,
      Math.max(1, this.renderer.capabilities?.getMaxAnisotropy?.() ?? 4),
    );

    const createMaterials = options.createMaterials ?? createProceduralMaterials;
    this.atmosphere = createAtmosphere(this.scene);
    this.materials = createMaterials(maxAnisotropy);
    this.terrain = buildTerrainAndRoads(this.materials);
    this.scene.add(this.terrain.group);

    this.architecture = buildArchitecture(this.materials);
    this.scene.add(this.architecture.group);

    this.vegetation = buildVegetationAndProps(this.materials);
    this.scene.add(this.vegetation.group);

    this.colliders = [
      ...this.terrain.colliders,
      ...this.architecture.colliders,
      ...this.vegetation.colliders,
    ];

    this.navigation = new NavigationController(this.camera, {
      colliders: this.colliders,
      initialView: INITIAL_VISTA,
      presets: CAMERA_PRESETS,
      domElement: options.canvas,
      onPresetChange: options.onPresetChange,
      onControlsToggle: options.onControlsToggle,
      onPointerLockChange: options.onPointerLockChange,
    });
  }

  public step(rawDt: number): BadaguanFrameResult {
    if (this.disposed) {
      return {
        snapshot: this.navigation.getState(),
        drawCalls: 0,
      };
    }

    const dt = Number.isFinite(rawDt) ? Math.min(0.1, Math.max(0, rawDt)) : 0;
    const navDt = Number.isFinite(rawDt) ? Math.min(0.6, Math.max(0, rawDt)) : 0;
    this.elapsedTime += dt;

    this.navigation.update(navDt);
    this.atmosphere.update(this.elapsedTime, this.camera.position);
    this.vegetation.update(this.elapsedTime, dt);
    this.renderer.render(this.scene, this.camera);

    return {
      snapshot: this.navigation.getState(),
      drawCalls: this.renderer.info.render.calls,
    };
  }

  public resize(width: number, height: number, devicePixelRatio = 1): void {
    if (this.disposed) return;
    const safeWidth = sanitizeDimension(width);
    const safeHeight = sanitizeDimension(height);
    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
    const safeDpr = sanitizePixelRatio(devicePixelRatio, this.softwareMode);
    this.renderer.setPixelRatio(safeDpr);
    this.renderer.setSize(safeWidth, safeHeight, false);
  }

  public selectPreset(oneBasedIndex: number): boolean {
    return this.navigation.selectPresetByIndex(oneBasedIndex);
  }

  public resetView(): void {
    this.navigation.resetToInitial();
  }

  public refreshShadows(): void {
    if (this.disposed) return;
    this.renderer.shadowMap.needsUpdate = true;
  }

  public getSnapshot(): NavigationSnapshot {
    return this.navigation.getState();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.navigation.dispose();
    this.vegetation.dispose();
    this.architecture.dispose();
    this.terrain.dispose();
    this.atmosphere.dispose();
    this.materials.dispose();
    this.renderer.dispose();
  }
}
