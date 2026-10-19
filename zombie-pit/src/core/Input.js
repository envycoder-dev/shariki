// Клавиатура/мышь с захватом указателя. «Нажато в этом кадре» сбрасывается в endFrame().
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.m = { dx: 0, dy: 0, left: false, right: false, leftHit: false, rightHit: false, wheel: 0 };
    this.locked = false;
    this.onLockChange = null;
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || (e.code === 'Space' && this.locked)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.m.left = this.m.right = false; });
    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.m.left = true; this.m.leftHit = true; }
      if (e.button === 2) { this.m.right = true; this.m.rightHit = true; }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.m.left = false;
      if (e.button === 2) this.m.right = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // защита от редких скачков movementX при захвате
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.m.dx += e.movementX; this.m.dy += e.movementY;
    });
    addEventListener('wheel', (e) => { if (this.locked) this.m.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.m.left = this.m.right = false; }
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch { /* нет поддержки */ } });
    } catch { try { this.canvas.requestPointerLock(); } catch { /* нет поддержки */ } }
  }

  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  endFrame() {
    this.pressed.clear();
    this.m.dx = this.m.dy = 0; this.m.leftHit = this.m.rightHit = false; this.m.wheel = 0;
  }
}
