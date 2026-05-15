"use strict";

// --- Binomial coefficient C(n,i) = n! / (i! * (n-i)!) ---
function binomial(n, i) {
  if (i < 0 || i > n) return 0;
  let coef = 1;
  for (let k = 0; k < i; k++) coef = coef * (n - k) / (k + 1);
  return coef;
}

// Bᵢⁿ(t) = C(n,i) * t^i * (1-t)^(n-i)
function bernstein(n, i, t) {
  return binomial(n, i) * Math.pow(t, i) * Math.pow(1 - t, n - i);
}


// --- (1) Bernstein form ---
// B(t) = (1-t)³P0 + 3t(1-t)²P1 + 3t²(1-t)P2 + t³P3
function cubicBezierBernstein(t, P0, P1, P2, P3) {
  const u  = 1 - t;
  const b0 = u * u * u;         // (1-t)³
  const b1 = 3 * t * u * u;     // 3t(1-t)²
  const b2 = 3 * t * t * u;     // 3t²(1-t)
  const b3 = t * t * t;         // t³
  return {
    x: b0*P0.x + b1*P1.x + b2*P2.x + b3*P3.x,
    y: b0*P0.y + b1*P1.y + b2*P2.y + b3*P3.y,
  };
}


// --- (2) Matrix form  B(t) = G · M · T ---
// G = [P0 P1 P2 P3]
// T = [t³ t² t 1]ᵀ
// M = Bezier basis matrix below
const BEZIER_MATRIX = [
  [-1,  3, -3, 1],
  [ 3, -6,  3, 0],
  [-3,  3,  0, 0],
  [ 1,  0,  0, 0],
];

function cubicBezierMatrix(t, P0, P1, P2, P3) {
  const T = [t*t*t, t*t, t, 1];   // parameter vector
  const M = BEZIER_MATRIX;

  // coef = T · M  →  4 blending coefficients
  const coef = [0, 0, 0, 0];
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++)
      coef[j] += T[i] * M[i][j];

  return {
    x: coef[0]*P0.x + coef[1]*P1.x + coef[2]*P2.x + coef[3]*P3.x,
    y: coef[0]*P0.y + coef[1]*P1.y + coef[2]*P2.y + coef[3]*P3.y,
  };
}


// --- (3) de Casteljau recursive ---
// bᵢʳ(t) = (1-t)·bᵢʳ⁻¹ + t·bᵢ₊₁ʳ⁻¹   complexity O(n²)
function deCasteljau(t, points) {
  let b = points.map(p => ({ x: p.x, y: p.y }));
  const u = 1 - t;
  while (b.length > 1) {
    const next = [];
    for (let i = 0; i < b.length - 1; i++) {
      next.push({
        x: u * b[i].x + t * b[i+1].x,
        y: u * b[i].y + t * b[i+1].y,
      });
    }
    b = next;
  }
  return b[0];
}


// --- Easing & interpolation ---

// smoothstep: zero velocity at t=0 and t=1
function easeInOut(t) {
  return t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpPoint(p1, p2, t) {
  return { x: lerp(p1.x, p2.x, t), y: lerp(p1.y, p2.y, t) };
}

// lerp every control point with easing applied
function interpolateShapes(A, B, t) {
  const e = easeInOut(t);
  return A.map((p, i) => lerpPoint(p, B[i], e));
}


// sample a cubic segment into a polyline (used by bernstein/matrix/decasteljau render paths)
function sampleCubic(P0, P1, P2, P3, steps = 24, evalFn = cubicBezierBernstein) {
  const out = [];
  for (let i = 0; i <= steps; i++)
    out.push(evalFn(i / steps, P0, P1, P2, P3));
  return out;
}
