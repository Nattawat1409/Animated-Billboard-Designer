# 🎨Animated Billboard Designer
**CPE361 Computer Graphics — Module 3-2 (Bézier Curve)**

Shape-morphing animation tool for digital signage. Users draw closed shapes
from cubic Bézier curves and the program animates smoothly between them with
ease-in-out timing.

---

## How to Run

Just open `index.html` in any modern browser (Chrome, Firefox, Edge, Safari).
No build step, no server, no dependencies — pure HTML + CSS + vanilla JS.

```
billboard-designer/
├── index.html      ← entry point
├── styles.css      ← all styling
├── README.md       ← this file
└── js/
    ├── bezier.js   ← Bézier math (lecture formulas)
    ├── shapes.js   ← shape utilities + presets
    └── app.js      ← main application
```

---

## Where Lecture Formulas Appear in the Code

All three forms of cubic Bézier evaluation from the lecture (Module 3-2) are
implemented in `js/bezier.js` and can be toggled live from the sidebar via the
**Bézier Method** dropdown — proving visually that all three produce the
same curve.

| Lecture Slide | Formula | Function in code |
|---|---|---|
| Slides 3, 5–6 | Bernstein form: B(t) = (1−t)³P₀ + 3t(1−t)²P₁ + 3t²(1−t)P₂ + t³P₃ | `cubicBezierBernstein()` |
| Slide 7 | Matrix form: B(t) = G · M · T | `cubicBezierMatrix()` |
| Slides 12–14 | de Casteljau recursive: bᵢʳ(t) = (1−t)·bᵢʳ⁻¹(t) + t·bᵢ₊₁ʳ⁻¹(t) | `deCasteljau()` |

Easing for the morph (Section 3 of the lab spec) is in `easeInOut()`, and
the core shape interpolation `interpolateShapes()` is the actual morphing
math from Section 1.

---

## How the Lab Requirements Are Satisfied

| Lab Section | Where in code |
|---|---|
| §1 Core Concept — interpolate control points over t ∈ [0,1] | `interpolateShapes()` in `bezier.js`, `animLoop()` in `app.js` |
| §2 Shape Creation — multiple Bézier curves into closed shape | `anchorsToBezier()` in `shapes.js` |
| §2 — consistent point count enforcement | `S.requiredN` lock in `app.js` |
| §3 Animation Generation — A→B→C→…→A loop | `animLoop()` uses `S.animT % S.animQueue.length` |
| §3 — ease-in-out easing | `easeInOut()` in `bezier.js` |
| §4 Visual Quality — twist-free ordering | `reorderToMatch()` in `shapes.js` |
| §5 Usability — status / edit / preview / error prevention | Status box, edit mode, preview render, toast warnings in `app.js` |

---

## Controls

| Action | Mouse | Keyboard |
|---|---|---|
| Draw new shape | "Draw New Shape" button | **D** |
| Place anchor | Click on canvas | — |
| Close shape | Click near first anchor • Double-click | **Space** |
| Edit existing shape | Drag any red anchor or gold handle | — |
| Add shape to queue | "Add to Animation" button | — |
| Discard current shape | "Discard Shape" button | **Esc** |
| Play / Stop animation | "Play" / "Stop" buttons | **P** |
| Reset everything | "Reset All" button | — |

---

## Default Presets

On load, the queue is populated with four flower-themed shapes that match
the visual style of the example in the lab document:

1. **Circle** (10 evenly spaced anchors)
2. **Flower A** (5 petals, smooth)
3. **Flower B** (5 petals, rotated half a petal — creates the wiggle effect)
4. **Heart** (parametric heart curve, 10 sampled points)

Press **Play** immediately to see the morph animation in action.
#
