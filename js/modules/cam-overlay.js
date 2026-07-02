// cam-overlay.js — skeleton overlay for the live camera view. Draws MoveNet
// keypoints onto a <canvas> stacked over the (CSS-mirrored) video; the canvas
// carries the same scaleX(-1) mirror, so raw keypoint coordinates map 1:1 and
// the skeleton tracks the user like a mirror. Purely cosmetic — never stores
// or transmits anything.

const MIN_SCORE = 0.3;

// Upper-body segment pairs (COCO indices). Face links keep the head readable.
const SEGMENTS = [
  [5, 6], // shoulders
  [5, 7], [7, 9], // left arm
  [6, 8], [8, 10], // right arm
  [5, 11], [6, 12], // torso
  [11, 12], // hips
  [3, 1], [1, 0], [0, 2], [2, 4], // ears–eyes–nose arc
];

const BAND_COLOR = {
  good: 'var(--color-success)',
  ok: 'var(--color-warn)',
  poor: 'var(--color-danger)',
  none: 'var(--color-info)',
};

/**
 * @param {HTMLCanvasElement} canvas  positioned over the video (see CSS)
 * @returns {{ draw(keypoints:object[]|null, band:string, videoW:number, videoH:number):void, clear():void }}
 */
export function createOverlay(canvas) {
  const ctx = canvas.getContext('2d');

  function resolveColor(varName) {
    // canvas can't consume CSS variables directly; resolve against the canvas.
    const raw = varName.startsWith('var(')
      ? getComputedStyle(canvas).getPropertyValue(varName.slice(4, -1)).trim()
      : varName;
    return raw || '#2f8273';
  }

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function draw(keypoints, band, videoW, videoH) {
    if (!videoW || !videoH) return;
    if (canvas.width !== videoW || canvas.height !== videoH) {
      canvas.width = videoW;
      canvas.height = videoH;
    }
    clear();
    if (!keypoints || !keypoints.length) return;

    const color = resolveColor(BAND_COLOR[band] || BAND_COLOR.none);
    const pt = (i) => {
      const k = keypoints[i];
      return k && (k.score == null || k.score >= MIN_SCORE) ? k : null;
    };

    ctx.lineWidth = Math.max(2, videoW / 220);
    ctx.lineCap = 'round';
    for (const [a, b] of SEGMENTS) {
      const ka = pt(a), kb = pt(b);
      if (!ka || !kb) continue;
      const conf = Math.min(ka.score ?? 1, kb.score ?? 1);
      ctx.strokeStyle = color;
      ctx.globalAlpha = Math.max(0.25, Math.min(1, conf));
      ctx.beginPath();
      ctx.moveTo(ka.x, ka.y);
      ctx.lineTo(kb.x, kb.y);
      ctx.stroke();
    }

    const r = Math.max(3, videoW / 160);
    for (const k of keypoints) {
      if (!k || (k.score != null && k.score < MIN_SCORE)) continue;
      ctx.fillStyle = color;
      ctx.globalAlpha = Math.max(0.3, Math.min(1, k.score ?? 1));
      ctx.beginPath();
      ctx.arc(k.x, k.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  return { draw, clear };
}
