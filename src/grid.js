// Spatial hash grid with per-cell linked lists, rebuilt each tick.
export class Grid {
  constructor(w, h, cell) {
    this.cell = cell;
    this.nx = Math.ceil(w / cell);
    this.ny = Math.ceil(h / cell);
    this.head = new Int32Array(this.nx * this.ny).fill(-1);
    this.next = new Int32Array(0);
    this.ox = 0; this.oy = 0;
    this.filled = 0;         // number of entries currently inserted
  }
  clear(n) {
    this.head.fill(-1);
    if (this.next.length < n) this.next = new Int32Array(n + 1024);
    this.filled = 0;
  }
  insert(i, x, y) {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    const c = (cy < 0 ? 0 : cy >= this.ny ? this.ny - 1 : cy) * this.nx +
              (cx < 0 ? 0 : cx >= this.nx ? this.nx - 1 : cx);
    this.next[i] = this.head[c];
    this.head[c] = i;
    this.filled++;
  }
  // returns array of indices within radius (unfiltered by exact distance)
  query(x, y, r, out) {
    out.length = 0;
    if (!this.filled) return out;
    const cs = this.cell;
    const cx0 = Math.max(0, Math.floor((x - r) / cs)), cx1 = Math.min(this.nx - 1, Math.floor((x + r) / cs));
    const cy0 = Math.max(0, Math.floor((y - r) / cs)), cy1 = Math.min(this.ny - 1, Math.floor((y + r) / cs));
    const cap = this.filled + 1;
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = cy * this.nx;
      for (let cx = cx0; cx <= cx1; cx++) {
        let i = this.head[row + cx];
        let guard = 0;
        while (i !== -1 && guard++ < cap) { out.push(i); i = this.next[i]; }
      }
    }
    return out;
  }
  queryRect(x0, y0, x1, y1, out) {
    out.length = 0;
    if (!this.filled) return out;
    const cs = this.cell;
    const cx0 = Math.max(0, Math.floor(x0 / cs)), cx1 = Math.min(this.nx - 1, Math.floor(x1 / cs));
    const cy0 = Math.max(0, Math.floor(y0 / cs)), cy1 = Math.min(this.ny - 1, Math.floor(y1 / cs));
    const cap = this.filled + 1;
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = cy * this.nx;
      for (let cx = cx0; cx <= cx1; cx++) {
        let i = this.head[row + cx];
        let guard = 0;
        while (i !== -1 && guard++ < cap) { out.push(i); i = this.next[i]; }
      }
    }
    return out;
  }
}
