/**
 * ProteinExperience.tsx
 * ----------------------------------------------------------------------------
 * Componente core 3D para una marca de proteína liofilizada (freeze-dried).
 *
 * PERFORMANCE & MATH POLISH (estrategia para 60 FPS estables):
 *  - Todo el estado de animación (scroll y puntero) vive en refs MUTABLES (.current).
 *    Se escribe desde listeners de DOM / GSAP, NUNCA con setState -> cero re-renders
 *    de React por frame.
 *  - useFrame NO asigna memoria: no se crea ni un Vector3, objeto literal ni array
 *    nuevo dentro del bucle. Solo aritmética sobre buffers Float32Array preasignados.
 *  - Interpolación frame-rate independent con MathUtils.damp / lerp (suaviza el
 *    "scrub" de GSAP y el lerp del mouse sin saltos).
 *  - Las posiciones de partículas se mutan in-place y se marca needsUpdate = true.
 * ----------------------------------------------------------------------------
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import * as THREE from 'three'
import { MathUtils } from 'three'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import './ProteinExperience.css'

gsap.registerPlugin(ScrollTrigger)

/* Estado compartido vía refs mutables (sin contexto de React, sin re-render). */
type Pointer = { x: number; y: number }
type SharedRefs = {
  scroll: MutableRefObject<number> // progreso de scroll normalizado 0..1
  pointer: MutableRefObject<Pointer> // posición del cursor en NDC (-1..1)
}

const PARTICLE_COUNT = 1800

/* Helper de remapeo de la fase de "release" (50% -> 100% del scroll). */
const releasePhase = (s: number) => (s <= 0.5 ? 0 : (s - 0.5) / 0.5)

/* -------------------------------------------------------------------------- */
/* EL BOTE: cilindro de vidrio (glassmorphism de alta transmisión)            */
/* -------------------------------------------------------------------------- */
function ProteinJar({ scroll, pointer }: SharedRefs) {
  const group = useRef<THREE.Group>(null!)

  useFrame((_, delta) => {
    const g = group.current

    // Scroll 0% -> 50%: una vuelta completa sobre su propio eje.
    const spin = (scroll.current <= 0.5 ? scroll.current / 0.5 : 1) * Math.PI * 2

    // Mouse: inclinación sutil siguiendo el cursor (lerp/damp = fluido y estable).
    const tiltX = pointer.current.y * 0.35
    const tiltY = pointer.current.x * 0.35

    g.rotation.x = MathUtils.damp(g.rotation.x, tiltX, 5, delta)
    g.rotation.z = MathUtils.damp(g.rotation.z, -tiltY * 0.4, 5, delta)
    g.rotation.y = MathUtils.damp(g.rotation.y, spin + tiltY, 5, delta)
  })

  return (
    <group ref={group}>
      {/* Cuerpo de vidrio — MeshPhysicalMaterial, transmisión alta + rugosidad baja */}
      <mesh>
        <cylinderGeometry args={[1, 1, 2.6, 96, 1, false]} />
        <meshPhysicalMaterial
          transmission={1}
          thickness={1.4}
          roughness={0.06}
          ior={1.45}
          clearcoat={1}
          clearcoatRoughness={0.08}
          metalness={0}
          color="#eaf7ff"
          attenuationColor="#aee2ff"
          attenuationDistance={2.4}
          transparent
        />
      </mesh>

      {/* Núcleo de polvo liofilizado: le da contenido que refractar al vidrio */}
      <mesh position={[0, -0.55, 0]}>
        <cylinderGeometry args={[0.82, 0.82, 1.35, 64]} />
        <meshStandardMaterial
          color="#f4eee2"
          roughness={0.92}
          emissive="#241c12"
          emissiveIntensity={0.25}
        />
      </mesh>

      {/* Sello del borde */}
      <mesh position={[0, 1.28, 0]}>
        <cylinderGeometry args={[1.02, 1.02, 0.08, 96]} />
        <meshStandardMaterial color="#8a929b" metalness={1} roughness={0.4} />
      </mesh>

      {/* Tapa metálica */}
      <mesh position={[0, 1.44, 0]}>
        <cylinderGeometry args={[1.06, 1.06, 0.3, 96]} />
        <meshStandardMaterial color="#d2d9e0" metalness={1} roughness={0.22} />
      </mesh>
    </group>
  )
}

/* -------------------------------------------------------------------------- */
/* PARTÍCULAS: cristales de hielo orbitando, con seno/coseno en useFrame        */
/* -------------------------------------------------------------------------- */
function IceParticles({ scroll }: Pick<SharedRefs, 'scroll'>) {
  const pointsRef = useRef<THREE.Points>(null!)
  const geomRef = useRef<THREE.BufferGeometry>(null!)

  // Buffers creados UNA sola vez. base = posiciones de reposo; live = buffer
  // que consume la geometría; seeds = [fase, velocidad, radio] por partícula.
  const { base, live, seeds } = useMemo(() => {
    const base = new Float32Array(PARTICLE_COUNT * 3)
    const seeds = new Float32Array(PARTICLE_COUNT * 3)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3
      const radius = 1.5 + Math.random() * 2.4
      const theta = Math.random() * Math.PI * 2
      base[i3] = Math.cos(theta) * radius
      base[i3 + 1] = (Math.random() - 0.5) * 5.5
      base[i3 + 2] = Math.sin(theta) * radius
      seeds[i3] = theta // fase = ángulo inicial
      seeds[i3 + 1] = 0.4 + Math.random() * 1.1 // velocidad orbital
      seeds[i3 + 2] = radius // radio base
    }
    return { base, live: base.slice(), seeds }
  }, [])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const release = releasePhase(scroll.current)

    // 50% -> 100%: liberación de nutrientes -> aceleran y se expanden a pantalla.
    const speed = 1 + release * 7
    const expand = 1 + release * release * 5
    const towardCamera = release * release * 7

    const arr = geomRef.current.attributes.position.array as Float32Array
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3
      const phase = seeds[i3]
      const sp = seeds[i3 + 1]
      const radius = seeds[i3 + 2] * expand
      const angle = phase + t * sp * 0.25 * speed

      arr[i3] = Math.cos(angle) * radius
      arr[i3 + 1] = base[i3 + 1] + Math.sin(t * sp + phase) * 0.35
      arr[i3 + 2] =
        Math.sin(angle) * radius + towardCamera * (0.5 + 0.5 * Math.sin(phase * 3))
    }
    geomRef.current.attributes.position.needsUpdate = true
    pointsRef.current.rotation.y = t * 0.03
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute attach="attributes-position" args={[live, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.035}
        sizeAttenuation
        transparent
        opacity={0.85}
        depthWrite={false}
        color="#dff4ff"
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

/* -------------------------------------------------------------------------- */
/* CÁMARA: zoom cinematográfico agresivo entrando al bote (50% -> 100%)        */
/* -------------------------------------------------------------------------- */
function CameraRig({ scroll }: Pick<SharedRefs, 'scroll'>) {
  const camera = useThree((s) => s.camera)
  const lookTarget = useMemo(() => new THREE.Vector3(0, 0, 0), []) // reutilizado

  useFrame((_, delta) => {
    const eased = releasePhase(scroll.current) ** 2 // ease-in agresivo
    const targetZ = MathUtils.lerp(6, 0.35, eased) // de fuera -> dentro del bote
    camera.position.z = MathUtils.damp(camera.position.z, targetZ, 6, delta)
    camera.position.y = MathUtils.damp(camera.position.y, eased * 0.6, 6, delta)
    camera.lookAt(lookTarget)
  })
  return null
}

/* -------------------------------------------------------------------------- */
/* ESCENA: luces de estudio dramáticas + entorno procedural para reflejos      */
/* -------------------------------------------------------------------------- */
function Scene({ scroll, pointer }: SharedRefs) {
  return (
    <>
      <color attach="background" args={['#05070a']} />
      <fog attach="fog" args={['#05070a', 8, 30]} />

      {/* AmbientLight baja + PointLight de contra intensa para silueta */}
      <ambientLight intensity={0.12} />
      <pointLight position={[0, 1.5, -6]} intensity={140} color="#bfe9ff" />
      <pointLight position={[4, 3, 4]} intensity={22} color="#ffffff" />
      <pointLight position={[-5, -2, 3]} intensity={12} color="#7aa7ff" />

      {/* Entorno procedural (sin fetch de HDRI por red) para que el vidrio refleje */}
      <Environment resolution={256}>
        <Lightformer intensity={3} position={[0, 0, -5]} scale={[12, 6, 1]} color="#cfeeff" />
        <Lightformer intensity={1.2} position={[5, 3, 2]} scale={[6, 6, 1]} color="#ffffff" />
        <Lightformer intensity={1} position={[-6, -2, 2]} scale={[6, 6, 1]} color="#88b6ff" />
      </Environment>

      <ProteinJar scroll={scroll} pointer={pointer} />
      <IceParticles scroll={scroll} />
      <CameraRig scroll={scroll} />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* COMPONENTE PÚBLICO: runway de scroll + Canvas sticky + overlay tipográfico   */
/* -------------------------------------------------------------------------- */
export default function ProteinExperience() {
  const containerRef = useRef<HTMLDivElement>(null!)
  const titleRef = useRef<HTMLDivElement>(null!)
  const hintRef = useRef<HTMLDivElement>(null!)

  // Refs de animación: el "single source of truth" del frame loop.
  const scroll = useRef(0)
  const pointer = useRef<Pointer>({ x: 0, y: 0 })

  // GSAP ScrollTrigger -> escribe scroll.current. Sin estado de React.
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: containerRef.current,
        start: 'top top',
        end: 'bottom bottom',
        scrub: true,
        onUpdate: (self) => {
          scroll.current = self.progress
        },
      })

      // Microinteracciones de salida del intro (tipografía que se desvanece).
      gsap.to(titleRef.current, {
        autoAlpha: 0,
        y: -40,
        ease: 'none',
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top top',
          end: '40% top',
          scrub: true,
        },
      })
      gsap.to(hintRef.current, {
        autoAlpha: 0,
        ease: 'none',
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top top',
          end: '8% top',
          scrub: true,
        },
      })
    }, containerRef)

    return () => ctx.revert()
  }, [])

  // Puntero -> NDC en pointer.current (lerp se aplica luego en useFrame).
  useLayoutEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  return (
    <div ref={containerRef} className="experience">
      <div className="experience__sticky">
        <Canvas
          className="experience__canvas"
          dpr={[1, 2]}
          camera={{ position: [0, 0, 6], fov: 35 }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
        >
          <Scene scroll={scroll} pointer={pointer} />
        </Canvas>

        <div className="experience__overlay">
          <div ref={titleRef} className="experience__intro">
            <p className="experience__eyebrow">FREEZE-DRIED · 100% WHEY ISOLATE</p>
            <h1 className="experience__title">
              CRYO<span>WHEY</span>
            </h1>
            <p className="experience__sub">
              Proteína liofilizada. Nutrientes intactos. Cero relleno.
            </p>
          </div>
          <div ref={hintRef} className="experience__hint">
            SCROLL
            <span className="experience__hint-line" />
          </div>
        </div>
      </div>
    </div>
  )
}
