/* A preset as a picture (issue #433): its mods' covers, its name, how many mods, and a QR code of
 * the site's link to it, which opens in the app or shows the mods to somebody who has not got it.
 * Easier to post in Discord or on a stream than a few hundred characters of link. Drawn here on a
 * canvas, in the window's own colours; nothing leaves the machine until the user pastes it. */
import qrcode from 'qrcode-generator';

/** What the picture shows. */
export interface PresetPicture { name: string; count: string; covers: string[]; link: string }

const W = 1200;
const H = 630;
const PAD = 48;
const QR_BOX = 300;

/** A token of the window's theme as a colour a canvas reads, through an element that resolves it. */
function token(name: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c || '#888';
}

/** A cover loaded so the canvas may be read back: one the server will not share is left out. */
function cover(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
    setTimeout(() => resolve(null), 8000);
  });
}

/** The squares of the link's QR code, the size a phone reads from a screen. */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, 'L');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** `img` scaled to fill a w x h box, its middle kept, with rounded corners. */
function drawCover(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number): void {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / s;
  const sh = h / s;
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, h, 14);
  g.clip();
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
  g.restore();
}

/** One line of `text` that fits `max` wide, cut with an ellipsis when it does not. */
function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** The picture as a PNG. */
export async function presetPicture(p: PresetPicture): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const [bg, surface, text, muted, primary] = ['--bg-base', '--surface-solid', '--text', '--text-muted', '--primary'].map(token);
  await document.fonts.ready;

  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = primary;
  g.fillRect(0, 0, W, 6);

  // the covers: up to eight, four to a row, the space left of the code
  const left = W - PAD * 3 - QR_BOX;
  const imgs = (await Promise.all(p.covers.slice(0, 8).map(cover))).filter((i): i is HTMLImageElement => Boolean(i));
  const cols = 4;
  const gap = 12;
  const cw = (left - gap * (cols - 1)) / cols;
  const ch = Math.round(cw * 9 / 16);
  const top = 200;
  for (let i = 0; i < 8; i++) {
    const x = PAD + (i % cols) * (cw + gap);
    const y = top + Math.floor(i / cols) * (ch + gap);
    if (imgs[i]) drawCover(g, imgs[i], x, y, cw, ch);
    else { g.fillStyle = surface; g.beginPath(); g.roundRect(x, y, cw, ch, 14); g.fill(); }
  }

  g.fillStyle = text;
  g.font = `700 56px 'Exo 2', system-ui, sans-serif`;
  g.textBaseline = 'alphabetic';
  g.fillText(fit(g, p.name, left), PAD, 104);
  g.fillStyle = muted;
  g.font = `500 26px Inter, system-ui, sans-serif`;
  g.fillText(fit(g, p.count, left), PAD, 150);
  g.font = `500 22px Inter, system-ui, sans-serif`;
  g.fillText('Dota 2 Mod Manager · dota2modmanager.com', PAD, H - PAD + 4);

  // the code on white, as every phone camera expects it, with its quiet zone
  const modules = qrModules(p.link);
  const qx = W - PAD - QR_BOX;
  const qy = (H - QR_BOX) / 2 - 20;
  g.fillStyle = '#fff';
  g.beginPath();
  g.roundRect(qx, qy, QR_BOX, QR_BOX, 18);
  g.fill();
  const quiet = 16;
  const cell = Math.floor((QR_BOX - quiet * 2) / modules.length);
  const off = (QR_BOX - cell * modules.length) / 2;
  g.fillStyle = '#000';
  modules.forEach((row, r) => row.forEach((dark, c) => {
    if (dark) g.fillRect(qx + off + c * cell, qy + off + r * cell, cell, cell);
  }));
  g.fillStyle = muted;
  g.font = `500 20px Inter, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillText(L`Наведи камеру телефона`, qx + QR_BOX / 2, qy + QR_BOX + 36);
  g.textAlign = 'start';

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no picture'))), 'image/png'));
}
