import type { ZoneInfo } from '../scene/DistrictLayout';
import type { CameraPreset } from '../scene/Presets';

export interface ControlsHintItem {
  keys: string;
  zh: string;
  en: string;
}

export const CONTROLS_HINT_ITEMS: readonly ControlsHintItem[] = [
  {
    keys: 'WASD / ↑ ↓ ← →',
    zh: '前後左右移動',
    en: 'Move',
  },
  {
    keys: 'Shift',
    zh: '加速奔跑',
    en: 'Sprint',
  },
  {
    keys: 'Drag / 雙擊或 F (Esc)',
    zh: '拖曳旋轉 / 鎖定滑鼠',
    en: 'Mouse Look / Pointer Lock',
  },
  {
    keys: '1 – 6',
    zh: '預設視角捷徑',
    en: 'Preset Viewpoints',
  },
  {
    keys: 'R',
    zh: '重置初始視角',
    en: 'Reset View',
  },
  {
    keys: 'H',
    zh: '顯示 / 隱藏說明',
    en: 'Toggle Controls',
  },
];

function sanitizeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || /\b(undefined|null|NaN)\b/i.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

export function formatZoneBadge(zone: ZoneInfo): { title: string; subtitle: string } {
  const title = sanitizeText(zone?.nameZh, '八大關歷史街區');
  const subtitle = sanitizeText(zone?.nameEn, 'Badaguan Historic District');
  return { title, subtitle };
}

export interface HudOverlayOptions {
  presets: readonly CameraPreset[];
  onSelectPreset: (oneBasedIndex: number) => void;
  onControlsVisibilityChange?: (visible: boolean) => void;
}

const ISOLATED_POINTER_EVENTS = [
  'pointerdown',
  'mousedown',
  'pointerup',
  'mouseup',
  'click',
  'dblclick',
] as const;

function stopPropagationOnly(e: Event): void {
  e.stopPropagation();
}

export class HudOverlay {
  private readonly root: HTMLElement;
  private readonly onSelectPreset: (oneBasedIndex: number) => void;
  private readonly onControlsVisibilityChange?: (visible: boolean) => void;

  private readonly loadingOverlay: HTMLDivElement;
  private readonly webglFallback: HTMLDivElement;
  private readonly fallbackMessageEl: HTMLParagraphElement;
  private readonly locationBadge: HTMLDivElement;
  private readonly zoneZhEl: HTMLDivElement;
  private readonly zoneEnEl: HTMLDivElement;
  private readonly controlsToggleBtn: HTMLButtonElement;
  private readonly controlsPanel: HTMLDivElement;
  private readonly presetBar: HTMLDivElement;
  private readonly presetButtons: HTMLButtonElement[] = [];
  private readonly isolatedElements: HTMLElement[] = [];

  private controlsVisible = false;
  private lastZoneKey = '';
  private lastActivePreset: string | null | undefined = undefined;
  private disposed = false;

  constructor(root: HTMLElement, options: HudOverlayOptions) {
    this.root = root;
    this.onSelectPreset = options.onSelectPreset;
    this.onControlsVisibilityChange = options.onControlsVisibilityChange;

    this.root.textContent = '';

    // 1. Loading overlay
    this.loadingOverlay = document.createElement('div');
    this.loadingOverlay.className = 'badaguan-loading-overlay';
    this.loadingOverlay.setAttribute('data-testid', 'loading-overlay');

    const loadingTitle = document.createElement('div');
    loadingTitle.className = 'badaguan-loading-title';
    loadingTitle.textContent = '青島八大關 · BADAGUAN';

    const loadingSub = document.createElement('div');
    loadingSub.className = 'badaguan-loading-sub';
    loadingSub.textContent = '正在載入金秋歷史街區景觀 · Loading 3D Historic District...';

    this.loadingOverlay.append(loadingTitle, loadingSub);

    // 2. WebGL fallback (hidden until init error)
    this.webglFallback = document.createElement('div');
    this.webglFallback.className = 'badaguan-webgl-fallback';
    this.webglFallback.setAttribute('data-testid', 'webgl-fallback');
    this.webglFallback.hidden = true;
    this.webglFallback.style.display = 'none';

    const fallbackHeading = document.createElement('h2');
    fallbackHeading.textContent = '無法啟用 3D WebGL2 渲染 · WebGL2 Unavailable';

    this.fallbackMessageEl = document.createElement('p');
    this.fallbackMessageEl.textContent =
      '此瀏覽器或裝置目前無法啟用 WebGL2 硬體／軟體渲染，請確認已開啟 WebGL 支援。';

    this.webglFallback.append(fallbackHeading, this.fallbackMessageEl);

    // 3. Location badge (top-left)
    this.locationBadge = document.createElement('div');
    this.locationBadge.className = 'badaguan-hud-card badaguan-location-badge';
    this.locationBadge.setAttribute('data-testid', 'location-badge');

    const kicker = document.createElement('div');
    kicker.className = 'badaguan-brand-kicker';
    kicker.textContent = '青島八大關 · BADAGUAN';

    this.zoneZhEl = document.createElement('div');
    this.zoneZhEl.className = 'badaguan-zone-zh';
    this.zoneZhEl.textContent = '八大關歷史街區';

    this.zoneEnEl = document.createElement('div');
    this.zoneEnEl.className = 'badaguan-zone-en';
    this.zoneEnEl.textContent = 'Badaguan Historic District';

    this.locationBadge.append(kicker, this.zoneZhEl, this.zoneEnEl);
    this.attachPointerIsolation(this.locationBadge);

    // 4. Controls toggle button (top-right)
    this.controlsToggleBtn = document.createElement('button');
    this.controlsToggleBtn.type = 'button';
    this.controlsToggleBtn.className = 'badaguan-hud-card badaguan-controls-toggle';
    this.controlsToggleBtn.setAttribute('data-testid', 'controls-toggle');
    this.controlsToggleBtn.setAttribute('aria-expanded', 'false');
    this.controlsToggleBtn.textContent = '? 操作說明 (H)';
    this.controlsToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.controlsToggleBtn.blur();
      this.toggleControlsPanel();
    });
    this.attachPointerIsolation(this.controlsToggleBtn);

    // 5. Controls panel (collapsible, hidden by default)
    this.controlsPanel = document.createElement('div');
    this.controlsPanel.className = 'badaguan-hud-card badaguan-controls-panel';
    this.controlsPanel.setAttribute('data-testid', 'controls-panel');
    this.controlsPanel.hidden = true;
    this.controlsPanel.style.display = 'none';

    const panelTitle = document.createElement('div');
    panelTitle.className = 'badaguan-controls-title';
    panelTitle.textContent = '導覽操作指南 · Controls';

    const list = document.createElement('ul');
    list.className = 'badaguan-controls-list';

    for (const item of CONTROLS_HINT_ITEMS) {
      const row = document.createElement('li');
      row.className = 'badaguan-controls-row';

      const keysSpan = document.createElement('span');
      keysSpan.className = 'badaguan-controls-keys';
      keysSpan.textContent = item.keys;

      const descSpan = document.createElement('span');
      descSpan.className = 'badaguan-controls-desc';
      descSpan.textContent = `${item.zh} · ${item.en}`;

      row.append(keysSpan, descSpan);
      list.appendChild(row);
    }

    this.controlsPanel.append(panelTitle, list);
    this.attachPointerIsolation(this.controlsPanel);

    // 6. Preset bar (bottom-center)
    this.presetBar = document.createElement('div');
    this.presetBar.className = 'badaguan-hud-card badaguan-preset-bar';
    this.presetBar.setAttribute('data-testid', 'preset-bar');
    this.attachPointerIsolation(this.presetBar);

    options.presets.forEach((preset, idx) => {
      const oneBased = idx + 1;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'badaguan-preset-btn';
      btn.setAttribute('data-testid', `preset-btn-${oneBased}`);
      btn.setAttribute('data-preset-id', preset.id);
      btn.setAttribute('aria-pressed', 'false');
      btn.title = `${preset.nameZh} · ${preset.nameEn}`;

      const numSpan = document.createElement('span');
      numSpan.className = 'badaguan-preset-num';
      numSpan.textContent = String(oneBased);

      const labelSpan = document.createElement('span');
      labelSpan.textContent = preset.shortZh;

      btn.append(numSpan, labelSpan);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.blur();
        this.onSelectPreset(oneBased);
      });
      this.presetButtons.push(btn);
      this.presetBar.appendChild(btn);
    });

    this.root.append(
      this.locationBadge,
      this.controlsToggleBtn,
      this.controlsPanel,
      this.presetBar,
      this.loadingOverlay,
      this.webglFallback,
    );
  }

  private attachPointerIsolation(el: HTMLElement): void {
    for (const evt of ISOLATED_POINTER_EVENTS) {
      el.addEventListener(evt, stopPropagationOnly);
    }
    this.isolatedElements.push(el);
  }

  public hideLoading(): void {
    this.loadingOverlay.hidden = true;
    this.loadingOverlay.style.display = 'none';
  }

  public showWebglFallback(reason?: string): void {
    this.hideLoading();
    if (reason && reason.trim().length > 0) {
      this.fallbackMessageEl.textContent =
        `無法初始化 3D WebGL2 場景 (${reason.trim()})。WebGL2 rendering is unavailable in this browser.`;
    }
    this.webglFallback.hidden = false;
    this.webglFallback.style.display = 'flex';
  }

  public hideWebglFallback(): void {
    this.webglFallback.hidden = true;
    this.webglFallback.style.display = 'none';
  }

  public isControlsVisible(): boolean {
    return this.controlsVisible;
  }

  public setControlsVisible(visible: boolean): void {
    if (this.disposed) return;
    this.controlsVisible = visible;
    this.controlsPanel.hidden = !visible;
    this.controlsPanel.style.display = visible ? 'block' : 'none';
    this.controlsToggleBtn.setAttribute('aria-expanded', visible ? 'true' : 'false');
    this.onControlsVisibilityChange?.(visible);
  }

  public toggleControlsPanel(): boolean {
    const next = !this.controlsVisible;
    this.setControlsVisible(next);
    return next;
  }

  public update(zone: ZoneInfo, activePreset: string | null): void {
    if (this.disposed) return;

    const formatted = formatZoneBadge(zone);
    const zoneKey = `${zone.id}|${formatted.title}|${formatted.subtitle}`;
    if (zoneKey !== this.lastZoneKey) {
      this.lastZoneKey = zoneKey;
      this.zoneZhEl.textContent = formatted.title;
      this.zoneEnEl.textContent = formatted.subtitle;
    }

    if (activePreset !== this.lastActivePreset) {
      this.lastActivePreset = activePreset;
      for (const btn of this.presetButtons) {
        const isActive = btn.getAttribute('data-preset-id') === activePreset;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      }
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const el of this.isolatedElements) {
      for (const evt of ISOLATED_POINTER_EVENTS) {
        el.removeEventListener(evt, stopPropagationOnly);
      }
    }
    this.isolatedElements.length = 0;
    this.presetButtons.length = 0;
    this.root.textContent = '';
  }
}
