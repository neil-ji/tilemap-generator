/* 最小 Canvas2D shim：让 src 的瓦片/渲染模块在纯 Node 下可跑（零依赖）。
   本实现复用项目验证脚本（render-phase2.mjs）已与浏览器输出对齐的 shim。
   两个必踩坑（见项目 memory canvas-shim-verification）：
   1. `_buf` 必须是 getter 引用闭包当前 buffer——静态捕获会在 width/height 重置后读到旧的全零 buffer；
   2. source-over 合成必须按 `dst_a = sa + da*(1-sa)` 混合 alpha——固定写 255 会把半透明覆盖层压成不透明暗块。 */
export function makeCanvas(w0, h0){
  let w = w0 || 1, h = h0 || 1;
  let buf = new Uint8ClampedArray(w * h * 4);
  function comp(x, y, r, g, b, a){
    if (x < 0 || y < 0 || x >= w || y >= h || a === 0) return;
    const di = (y * w + x) * 4;
    if (a === 255){ buf[di] = r; buf[di + 1] = g; buf[di + 2] = b; buf[di + 3] = 255; return; }
    const da = buf[di + 3] / 255, sa = a / 255, oa = sa + da * (1 - sa);
    if (oa <= 0){ buf[di] = buf[di + 1] = buf[di + 2] = buf[di + 3] = 0; return; }
    buf[di] = Math.round((r * sa + buf[di] * da * (1 - sa)) / oa);
    buf[di + 1] = Math.round((g * sa + buf[di + 1] * da * (1 - sa)) / oa);
    buf[di + 2] = Math.round((b * sa + buf[di + 2] * da * (1 - sa)) / oa);
    buf[di + 3] = Math.round(oa * 255);
  }
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, imageSmoothingEnabled: false,
    _path: null,
    _parse(s){
      if (typeof s === 'string' && s[0] === '#'){ const v = parseInt(s.slice(1, 7), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255, 255]; }
      const m = (s || '').match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 255];
      const p = m[1].split(',').map(parseFloat);
      const a = Math.max(0, Math.min(255, Math.round((p.length > 3 ? p[3] : 1) * this.globalAlpha * 255)));
      return [p[0] | 0, p[1] | 0, p[2] | 0, a];
    },
    getImageData(x, y, w2, h2){
      const data = new Uint8ClampedArray(w2 * h2 * 4);
      for (let yy = 0; yy < h2; yy++){ const sy = y + yy;
        for (let xx = 0; xx < w2; xx++){ const sx = x + xx; const di = (yy * w2 + xx) * 4;
          if (sx >= 0 && sx < w && sy >= 0 && sy < h){ const si = (sy * w + sx) * 4; data[di] = buf[si]; data[di + 1] = buf[si + 1]; data[di + 2] = buf[si + 2]; data[di + 3] = buf[si + 3]; } } }
      return { data, width: w2, height: h2 };
    },
    createImageData(w2, h2){ return { data: new Uint8ClampedArray(w2 * h2 * 4), width: w2, height: h2 }; },
    putImageData(img, ox, oy){
      const sw = img.width, sh = img.height;
      for (let yy = 0; yy < sh; yy++){ const ty = oy + yy; if (ty < 0 || ty >= h) continue;
        for (let xx = 0; xx < sw; xx++){ const tx = ox + xx; if (tx < 0 || tx >= w) continue;
          const si = (yy * sw + xx) * 4, di = (ty * w + tx) * 4;
          buf[di] = img.data[si]; buf[di + 1] = img.data[si + 1]; buf[di + 2] = img.data[si + 2]; buf[di + 3] = img.data[si + 3]; } }
    },
    drawImage(src, dx, dy){
      const sb = src._buf, sw = src.width, sh = src.height;
      for (let yy = 0; yy < sh; yy++){ const ty = dy + yy; if (ty < 0 || ty >= h) continue;
        for (let xx = 0; xx < sw; xx++){ const tx = dx + xx; if (tx < 0 || tx >= w) continue;
          const si = (yy * sw + xx) * 4; comp(tx, ty, sb[si], sb[si + 1], sb[si + 2], sb[si + 3]); } }
    },
    fillRect(x, y, w2, h2){
      const [r, g, b, a] = this._parse(this.fillStyle);
      for (let yy = Math.max(0, y | 0); yy < Math.min(h, (y + h2) | 0); yy++)
        for (let xx = Math.max(0, x | 0); xx < Math.min(w, (x + w2) | 0); xx++) comp(xx, yy, r, g, b, a);
    },
    clearRect(x, y, w2, h2){
      for (let yy = Math.max(0, y | 0); yy < Math.min(h, (y + h2) | 0); yy++)
        for (let xx = Math.max(0, x | 0); xx < Math.min(w, (x + w2) | 0); xx++){ const di = (yy * w + xx) * 4; buf[di] = buf[di + 1] = buf[di + 2] = buf[di + 3] = 0; }
    },
    beginPath(){ this._path = []; }, moveTo(x, y){ this._path = [x, y]; }, lineTo(x, y){ this._path.push(x, y); },
    stroke(){
      const [r, g, b, a] = this._parse(this.strokeStyle); const p = this._path;
      for (let i = 0; i < p.length - 2; i += 2){
        const x1 = p[i], y1 = p[i + 1], x2 = p[i + 2], y2 = p[i + 3];
        if (y1 === y2){ const y0 = Math.round(y1); for (let xx = Math.round(Math.min(x1, x2)); xx <= Math.round(Math.max(x1, x2)); xx++) comp(xx, y0, r, g, b, a); }
        else if (x1 === x2){ const x0 = Math.round(x1); for (let yy = Math.round(Math.min(y1, y2)); yy <= Math.round(Math.max(y1, y2)); yy++) comp(x0, yy, r, g, b, a); }
      }
    },
    save(){}, restore(){},
    set globalCompositeOperation(v){}, get globalCompositeOperation(){ return 'source-over'; },
  };
  const c = {
    get width(){ return w; }, set width(v){ w = v; buf = new Uint8ClampedArray(w * h * 4); },
    get height(){ return h; }, set height(v){ h = v; buf = new Uint8ClampedArray(w * h * 4); },
    get _buf(){ return buf; }, getContext(){ return ctx; },
  };
  Object.defineProperty(ctx, 'canvas', { get: () => c });
  return c;
}
globalThis.document = { createElement: () => makeCanvas(16, 16) };
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };
