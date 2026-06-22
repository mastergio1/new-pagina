---
name: performance-math-polish
description: Use when building or reviewing React Three Fiber / Three.js / WebGL components, shaders, or scroll/pointer-driven 3D scenes. Enforces stable 60 FPS through mutable refs (.current) as the single source of animation state, zero allocations inside useFrame, and frame-rate-independent smoothing with MathUtils.damp/lerp. Trigger on tasks mentioning useFrame, particles, BufferGeometry, GSAP ScrollTrigger + 3D, camera rigs, or "make the render smooth / 60fps".
---

# Performance & Math Polish

High-end WebGL feel comes from two things: **never blocking the render loop**
and **mathematically smooth motion**. Apply every rule below to any R3F/Three.js
code you write or review.

## 1. State lives in mutable refs, not React state
Animation inputs (scroll progress, pointer position, time-driven values) must be
stored in `useRef(...).current` and written from DOM listeners or GSAP callbacks.

- ✅ `scroll.current = self.progress` inside a ScrollTrigger `onUpdate`.
- ❌ `setScroll(self.progress)` — this re-renders React 60×/sec and tanks FPS.

Share these refs with child components via props; do **not** put per-frame values
in Context that triggers renders.

## 2. `useFrame` allocates nothing
The frame loop runs 60–120×/sec. A single `new THREE.Vector3()` per frame is
garbage the GC must collect, causing jank.

- Preallocate scratch objects once with `useMemo(() => new THREE.Vector3(), [])`
  and reuse them.
- For particles, preallocate `Float32Array` buffers once and **mutate in place**:
  ```ts
  const arr = geom.current.attributes.position.array as Float32Array
  for (let i = 0; i < COUNT; i++) { /* arr[i*3] = ... only number math */ }
  geom.current.attributes.position.needsUpdate = true
  ```
- No object/array literals, `.map`, `.filter`, or `.slice` inside `useFrame`.

## 3. Smooth with damp/lerp, never hard assignment
Direct assignment to a target snaps and looks cheap; it also couples motion to
frame rate.

- Use `THREE.MathUtils.damp(current, target, lambda, delta)` (frame-rate
  independent) or `MathUtils.lerp(current, target, t)` for pointer/scroll easing.
- This also absorbs the discrete steps of GSAP `scrub`, hiding scroll jitter.

## 4. Keep one source of truth per value
Separate immutable base data from the live buffer the GPU reads:
`base` (rest positions) + `seeds` (per-item params) computed once, `live =
base.slice()` mutated each frame. Math.random for seeding belongs in `useMemo`,
never in the loop.

## 5. Lint reality for R3F
The React Compiler-style rules `react-hooks/purity` and
`react-hooks/immutability` flag the *correct* R3F pattern (mutating the camera /
geometry in `useFrame`, seeding with `Math.random` in `useMemo`). Disable those
two rules for the 3D component files — do **not** rewrite idiomatic R3F to
satisfy them.

## Quick checklist before finishing
- [ ] No `useState` driven by scroll/pointer/time.
- [ ] `useFrame` body contains only number math + in-place buffer writes.
- [ ] All vectors/targets preallocated via `useMemo`/`useRef`.
- [ ] Easing uses `damp`/`lerp`, not `=`.
- [ ] `needsUpdate = true` after mutating any BufferAttribute.
- [ ] `dpr={[1, 2]}` on `<Canvas>` to cap pixel cost on retina.
