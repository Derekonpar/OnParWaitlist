"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export type SceneLane = {
  lane: number;
  status: "open" | "occupied" | "reserved" | "unknown";
  warning: boolean;
};

type Props = {
  lanes: SceneLane[];
  selectedLane: number;
  onSelectLane: (lane: number) => void;
  onReady?: (ready: boolean) => void;
};

const LANE_WIDTH = 1.68;
const LANE_SPACING = 2.12;
const LANE_LENGTH = 25;
const COLORS = {
  open: new THREE.Color("#12edac"),
  occupied: new THREE.Color("#8393a0"),
  reserved: new THREE.Color("#ffaf42"),
  unknown: new THREE.Color("#405367"),
  warning: new THREE.Color("#ff595b"),
};

const FLOOR_VERTEX = `
  varying vec2 vLaneUv;
  void main() {
    vLaneUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The grain and reflected LED light are evaluated on the actual 3D lane surface.
// No live activity is inferred or animated by the presentation layer.
const FLOOR_FRAGMENT = `
  uniform vec3 laneColor;
  uniform float laneEnergy;
  uniform float focus;
  varying vec2 vLaneUv;
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2(1., 0.)), f.x),
               mix(hash(cell + vec2(0., 1.)), hash(cell + vec2(1.)), f.x), f.y);
  }
  void main() {
    vec2 uv = vLaneUv;
    float plank = floor(uv.x * 19.0);
    float seam = smoothstep(.015, .06, fract(uv.x * 19.0)) *
      (1.0 - smoothstep(.94, .985, fract(uv.x * 19.0)));
    float grain = noise(vec2(uv.x * 38.0, uv.y * 3.0));
    float boardShade = hash(vec2(plank, floor(uv.y * 5.0 + hash(vec2(plank, 9.))))) * .004;
    vec3 base = vec3(.026, .037, .041) + vec3(.012, .013, .009) * grain;
    base += boardShade;
    base *= mix(.9, 1.0, seam);
    base *= mix(.43, 1.0, smoothstep(.1, .25, laneEnergy));
    float edges = pow(1.0 - min(uv.x, 1.0 - uv.x), 9.0);
    float reflectedStrip = exp(-pow((uv.x - .34) * 10.0, 2.0));
    float secondStrip = exp(-pow((uv.x - .78) * 19.0, 2.0));
    float endGlow = exp(-pow((uv.y - .91) * 4.1, 2.0));
    float sheen = reflectedStrip * (.018 + endGlow * .032) + secondStrip * .016;
    vec3 color = base + vec3(.37, .47, .53) * sheen;
    color += laneColor * laneEnergy * (.028 + edges * .29 + endGlow * .055);
    color += laneColor * laneEnergy * reflectedStrip * (.045 + endGlow * .045);
    color += laneColor * focus * (.012 + edges * .07);
    // Soft stretched reflections beneath the standing pin rack.
    float pinReflection = 0.0;
    for (int i = 0; i < 4; i++) {
      float pinX = .19 + float(i) * .205;
      pinReflection += exp(-pow((uv.x - pinX) * 42.0, 2.0));
    }
    color += vec3(.4, .49, .48) * pinReflection *
      exp(-pow((uv.y - .84) * 12.0, 2.0)) * .055;
    color *= .65 + .35 * smoothstep(0.0, .35, uv.y);
    gl_FragColor = vec4(color, 1.0);
  }
`;

function numberTexture(lane: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#ecf8ff";
    context.font = "600 126px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(lane), 96, 104);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export default function BowlingLaneScene({
  lanes,
  selectedLane,
  onSelectLane,
  onReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ lanes, selectedLane, onSelectLane, onReady });
  const invalidateRef = useRef<() => void>(() => {});

  useEffect(() => {
    propsRef.current = { lanes, selectedLane, onSelectLane, onReady };
    invalidateRef.current();
  }, [lanes, selectedLane, onSelectLane, onReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const unavailableNotice = document.createElement("p");
    unavailableNotice.setAttribute("role", "status");
    unavailableNotice.textContent = "3D view unavailable. Use the lane cards below to view lane details.";
    Object.assign(unavailableNotice.style, {
      position: "absolute", inset: "0", display: "grid", placeItems: "center",
      margin: "0", padding: "32px", color: "#a9bdca", background: "#07121c",
      fontSize: "14px", textAlign: "center", zIndex: "1",
    });
    const showUnavailable = () => {
      if (!unavailableNotice.isConnected) container.appendChild(unavailableNotice);
      propsRef.current.onReady?.(false);
    };

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "low-power",
        // Frames are drawn on demand, so keep the settled image available when
        // Chrome recomposites the dashboard after scrolling or taking a snapshot.
        preserveDrawingBuffer: true,
      });
    } catch {
      showUnavailable();
      return () => unavailableNotice.remove();
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#07121c");
    scene.fog = new THREE.Fog("#07121c", 140, 240);
    // A long lens keeps the 12-lane panorama broad while retaining true perspective.
    const camera = new THREE.PerspectiveCamera(12, 1, 0.1, 300);
    const rendererCanvas = renderer.domElement;
    rendererCanvas.style.display = "block";
    rendererCanvas.style.width = "100%";
    rendererCanvas.style.height = "100%";
    rendererCanvas.style.touchAction = "pan-x pan-y";
    rendererCanvas.setAttribute("aria-hidden", "true");
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(rendererCanvas);

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.5, 1.12);
    const outputPass = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(bloom);
    composer.addPass(outputPass);

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    const geometry = <T extends THREE.BufferGeometry>(value: T) => {
      geometries.add(value);
      return value;
    };
    const material = <T extends THREE.Material>(value: T) => {
      materials.add(value);
      return value;
    };
    const box = (x: number, y: number, z: number) =>
      geometry(new THREE.BoxGeometry(x, y, z));
    const metal = material(new THREE.MeshStandardMaterial({
      color: "#17212b", metalness: 0.68, roughness: 0.35,
    }));
    const darkMetal = material(new THREE.MeshStandardMaterial({
      color: "#09111a", metalness: 0.55, roughness: 0.42,
    }));
    const sideMetal = material(new THREE.MeshStandardMaterial({
      color: "#243641", metalness: 0.72, roughness: 0.31,
    }));
    const pinMaterial = material(new THREE.MeshStandardMaterial({
      color: "#b2c5c8", roughness: 0.22, metalness: 0.07,
      emissive: "#879d98", emissiveIntensity: 0.025,
    }));
    const pinBandMaterial = material(new THREE.MeshStandardMaterial({
      color: "#ef4f58", roughness: 0.3, metalness: 0.06,
    }));
    const markingMaterial = material(new THREE.MeshBasicMaterial({
      color: "#afc3c5", transparent: true, opacity: 0.28,
    }));

    scene.add(new THREE.HemisphereLight("#bedcf5", "#142124", 1.25));
    const keyLight = new THREE.DirectionalLight("#eaf7ff", 1.65);
    keyLight.position.set(-8, 18, 5);
    scene.add(keyLight);
    const rearLight = new THREE.DirectionalLight("#819cad", 0.75);
    rearLight.position.set(5, 9, -15);
    scene.add(rearLight);

    const platform = new THREE.Mesh(box(27.4, 0.7, 29.2), darkMetal);
    platform.position.set(0, -0.55, -0.25);
    scene.add(platform);
    const approach = new THREE.Mesh(box(27.1, 0.16, 2.0), metal);
    approach.position.set(0, -0.10, 13.6);
    scene.add(approach);
    const backdrop = new THREE.Mesh(box(27.4, 3.5, 0.38), darkMetal);
    backdrop.position.set(0, 1.2, -14);
    scene.add(backdrop);

    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(box(0.28, 1.0, 29.1), darkMetal);
      wall.position.set(side * 13.55, -0.02, -0.2);
      scene.add(wall);
      const trim = new THREE.Mesh(box(0.05, 0.045, 29.1), sideMetal);
      trim.position.set(side * 13.38, 0.49, -0.2);
      scene.add(trim);
    }

    const pinProfile = [
      [0.09, 0], [0.15, 0.025], [0.19, 0.14], [0.2, 0.26],
      [0.175, 0.4], [0.115, 0.55], [0.078, 0.67], [0.078, 0.8],
      [0.12, 0.9], [0.135, 0.99], [0.12, 1.075], [0.07, 1.13], [0, 1.15],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const pinGeometry = geometry(new THREE.LatheGeometry(pinProfile, 14));
    const bandGeometry = geometry(new THREE.CylinderGeometry(0.083, 0.083, 0.035, 14));
    const pins = new THREE.InstancedMesh(pinGeometry, pinMaterial, 120);
    const bands = new THREE.InstancedMesh(bandGeometry, pinBandMaterial, 240);
    const transform = new THREE.Object3D();
    let pinIndex = 0;
    let bandIndex = 0;

    const laneGeometry = geometry(new THREE.PlaneGeometry(LANE_WIDTH, LANE_LENGTH));
    const bedGeometry = box(LANE_WIDTH + 0.06, 0.2, LANE_LENGTH);
    const railGeometry = box(0.045, 0.035, LANE_LENGTH);
    const gutterGeometry = box(0.16, 0.14, LANE_LENGTH);
    const gutterRimGeometry = box(0.03, 0.04, LANE_LENGTH);
    const boardGeometry = box(1.95, 2.35, 0.36);
    const numberGeometry = geometry(new THREE.PlaneGeometry(1.30, 1.3));
    const barGeometry = box(1.45, 0.036, 0.025);
    const dotGeometry = geometry(new THREE.CircleGeometry(0.105, 24));
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 0.095);
    arrowShape.lineTo(-0.042, -0.035);
    arrowShape.lineTo(0, 0.0);
    arrowShape.lineTo(0.042, -0.035);
    arrowShape.closePath();
    const arrowGeometry = geometry(new THREE.ShapeGeometry(arrowShape));
    const hitGeometry = box(LANE_SPACING, 2.8, LANE_LENGTH + 1.5);
    const hitMaterial = material(new THREE.MeshBasicMaterial({
      visible: false,
    }));
    const selectable: THREE.Mesh[] = [];
    const laneVisuals: {
      lane: number;
      floor: THREE.ShaderMaterial;
      glow: THREE.MeshBasicMaterial;
      board: THREE.MeshStandardMaterial;
      focus: number;
      color: THREE.Color;
    }[] = [];

    for (let lane = 1; lane <= 12; lane += 1) {
      const x = (lane - 6.5) * LANE_SPACING;
      const bed = new THREE.Mesh(bedGeometry, metal);
      bed.position.set(x, -0.13, 0);
      scene.add(bed);
      const floor = material(new THREE.ShaderMaterial({
        vertexShader: FLOOR_VERTEX,
        fragmentShader: FLOOR_FRAGMENT,
        uniforms: {
          laneColor: { value: COLORS.unknown.clone() },
          laneEnergy: { value: 0.17 },
          focus: { value: 0 },
        },
      }));
      const surface = new THREE.Mesh(laneGeometry, floor);
      surface.rotation.x = -Math.PI / 2;
      surface.position.set(x, -0.025, 0);
      scene.add(surface);
      const glow = material(new THREE.MeshBasicMaterial({ color: COLORS.unknown.clone() }));

      for (const side of [-1, 1]) {
        const gutter = new THREE.Mesh(gutterGeometry, darkMetal);
        gutter.position.set(x + side * (LANE_WIDTH / 2 + 0.11), -0.11, 0);
        scene.add(gutter);
        const rim = new THREE.Mesh(gutterRimGeometry, sideMetal);
        rim.position.set(x + side * (LANE_WIDTH / 2 + 0.2), -0.025, 0);
        scene.add(rim);
        const led = new THREE.Mesh(railGeometry, glow);
        led.position.set(x + side * (LANE_WIDTH / 2 - 0.012), 0.015, 0);
        scene.add(led);
      }

      const boardMat = material(new THREE.MeshStandardMaterial({
        color: "#12202c", metalness: 0.5, roughness: 0.36,
        emissive: COLORS.unknown.clone(), emissiveIntensity: 0.04,
      }));
      const board = new THREE.Mesh(boardGeometry, boardMat);
      board.position.set(x, 1.2, -13.38);
      scene.add(board);
      const texture = numberTexture(lane);
      textures.add(texture);
      const digits = new THREE.Mesh(numberGeometry, material(new THREE.MeshBasicMaterial({
        map: texture, transparent: true, depthWrite: false,
        color: "#e4f1f4",
      })));
      digits.position.set(x, 1.62, -13.19);
      scene.add(digits);
      const indicator = new THREE.Mesh(barGeometry, glow);
      indicator.position.set(x, 0.46, -13.18);
      scene.add(indicator);

      const frontDot = new THREE.Mesh(dotGeometry, glow);
      frontDot.rotation.x = -Math.PI / 2;
      frontDot.position.set(x, 0.01, 13.15);
      scene.add(frontDot);

      for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column <= row; column += 1) {
          const pinX = x + (column - row / 2) * 0.38;
          const pinZ = -10.48 - row * 0.49;
          transform.position.set(pinX, 0, pinZ);
          transform.updateMatrix();
          pins.setMatrixAt(pinIndex++, transform.matrix);
          for (const y of [0.715, 0.78]) {
            transform.position.set(pinX, y, pinZ);
            transform.updateMatrix();
            bands.setMatrixAt(bandIndex++, transform.matrix);
          }
        }
      }
      for (let arrow = -3; arrow <= 3; arrow += 1) {
        const mark = new THREE.Mesh(arrowGeometry, markingMaterial);
        mark.rotation.x = -Math.PI / 2;
        mark.position.set(x + arrow * 0.185, 0.002, 4.1 + Math.abs(arrow) * 0.45);
        scene.add(mark);
      }
      const hitbox = new THREE.Mesh(hitGeometry, hitMaterial);
      hitbox.position.set(x, 0.9, -0.3);
      hitbox.userData.lane = lane;
      selectable.push(hitbox);
      scene.add(hitbox);
      laneVisuals.push({ lane, floor, glow, board: boardMat, focus: 0, color: COLORS.unknown.clone() });
    }
    scene.add(pins, bands);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cameraTarget = new THREE.Vector3(0, 0.1, -0.6);
    const baseCamera = new THREE.Vector3(0, 23, 30);
    let hoveredLane = 0;
    let targetLean = 0;
    let currentLean = 0;
    let frame = 0;
    let lastFrame = 0;
    let onScreen = true;
    let contextLost = false;
    let disposed = false;
    let reportedReady = false;
    let renderWidth = 0;
    let renderHeight = 0;
    let downPosition: { x: number; y: number } | null = null;

    function requestFrame() {
      if (!frame && !disposed && !document.hidden && onScreen && !contextLost) {
        frame = window.requestAnimationFrame(draw);
      }
    }

    function draw(time: number) {
      frame = 0;
      if (disposed || document.hidden || !onScreen || contextLost) return;
      if (time - lastFrame < 1000 / 30) {
        requestFrame();
        return;
      }
      lastFrame = time;
      let transitioning = false;
      const blend = reducedMotion.matches ? 1 : 0.2;
      const current = propsRef.current;
      for (const visual of laneVisuals) {
        const laneState = current.lanes.find((lane) => lane.lane === visual.lane);
        const status = laneState?.status ?? "unknown";
        const color = laneState?.warning ? COLORS.warning : COLORS[status];
        const targetFocus = current.selectedLane === visual.lane ? 1 : hoveredLane === visual.lane ? 0.52 : 0;
        visual.focus = THREE.MathUtils.lerp(visual.focus, targetFocus, blend);
        if (Math.abs(visual.focus - targetFocus) < 0.002) visual.focus = targetFocus;
        visual.color.lerp(color, blend);
        const colorDifference = Math.abs(visual.color.r - color.r) +
          Math.abs(visual.color.g - color.g) + Math.abs(visual.color.b - color.b);
        if (colorDifference < 0.003) visual.color.copy(color);
        if (visual.focus !== targetFocus || colorDifference >= 0.003) transitioning = true;
        const energy = status === "open" || laneState?.warning || status === "reserved" ? 1 : status === "occupied" ? 0.24 : 0.1;
        visual.floor.uniforms.laneColor.value.copy(visual.color);
        visual.floor.uniforms.laneEnergy.value = energy;
        visual.floor.uniforms.focus.value = visual.focus;
        visual.glow.color.copy(visual.color).multiplyScalar((energy > 0.5 ? 2.35 : 0.66) + visual.focus * 0.65);
        visual.board.emissive.copy(visual.color);
        visual.board.emissiveIntensity = 0.035 + visual.focus * 0.10;
      }
      currentLean = THREE.MathUtils.lerp(currentLean, reducedMotion.matches ? 0 : targetLean, blend);
      if (Math.abs(currentLean - targetLean) > 0.003 && !reducedMotion.matches) transitioning = true;
      camera.position.copy(baseCamera);
      camera.position.x += currentLean;
      camera.lookAt(cameraTarget);
      try {
        composer.render();
        if (!reportedReady) {
          reportedReady = true;
          current.onReady?.(true);
        }
      } catch {
        contextLost = true;
        showUnavailable();
        return;
      }
      if (transitioning) requestFrame();
    }

    function resize() {
      const width = Math.max(container!.clientWidth, 1);
      const height = Math.max(container!.clientHeight, 1);
      if (width !== renderWidth || height !== renderHeight) {
        renderer.setSize(width, height, false);
        composer.setSize(width, height);
        renderWidth = width;
        renderHeight = height;
      }
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // Fit the physical scene, including near corners, at every container ratio.
      const direction = new THREE.Vector3(0, 0.3, 0.954).normalize();
      let distance = 29;
      for (let attempt = 0; attempt < 64; attempt += 1) {
        camera.position.copy(cameraTarget).addScaledVector(direction, distance);
        camera.lookAt(cameraTarget);
        camera.updateMatrixWorld();
        let fits = true;
        for (const x of [-13.85, 13.85]) {
          for (const z of [-14.2, 14.3]) {
            const corner = new THREE.Vector3(x, z < 0 ? 2.8 : 0, z).project(camera);
            if (Math.abs(corner.x) > 0.95 || Math.abs(corner.y) > 0.91) fits = false;
          }
        }
        if (fits) break;
        distance *= 1.04;
      }
      baseCamera.copy(camera.position);
      requestFrame();
    }

    function laneAt(event: PointerEvent) {
      const bounds = rendererCanvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      return (raycaster.intersectObjects(selectable, false)[0]?.object.userData.lane as number | undefined) ?? 0;
    }
    function pointerMove(event: PointerEvent) {
      hoveredLane = laneAt(event);
      targetLean = event.pointerType === "mouse" ? pointer.x * 0.32 : 0;
      rendererCanvas.style.cursor = hoveredLane ? "pointer" : "default";
      requestFrame();
    }
    function pointerLeave() {
      hoveredLane = 0;
      targetLean = 0;
      downPosition = null;
      rendererCanvas.style.cursor = "default";
      requestFrame();
    }
    function pointerDown(event: PointerEvent) {
      downPosition = { x: event.clientX, y: event.clientY };
    }
    function pointerUp(event: PointerEvent) {
      if (!downPosition || Math.hypot(event.clientX - downPosition.x, event.clientY - downPosition.y) > 7) {
        downPosition = null;
        return;
      }
      downPosition = null;
      const lane = laneAt(event);
      if (lane) propsRef.current.onSelectLane(lane);
      requestFrame();
    }
    function visibilityChange() {
      if (document.hidden && frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      } else requestFrame();
    }
    function onContextLost(event: Event) {
      event.preventDefault();
      contextLost = true;
      reportedReady = false;
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      showUnavailable();
    }
    function onContextRestored() {
      contextLost = false;
      unavailableNotice.remove();
      resize();
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (!onScreen && frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      } else requestFrame();
    }, { rootMargin: "60px" });
    intersectionObserver.observe(container);
    rendererCanvas.addEventListener("pointermove", pointerMove);
    rendererCanvas.addEventListener("pointerleave", pointerLeave);
    rendererCanvas.addEventListener("pointerdown", pointerDown);
    rendererCanvas.addEventListener("pointerup", pointerUp);
    rendererCanvas.addEventListener("pointercancel", pointerLeave);
    rendererCanvas.addEventListener("webglcontextlost", onContextLost);
    rendererCanvas.addEventListener("webglcontextrestored", onContextRestored);
    document.addEventListener("visibilitychange", visibilityChange);
    reducedMotion.addEventListener("change", requestFrame);
    invalidateRef.current = requestFrame;
    resize();

    return () => {
      disposed = true;
      invalidateRef.current = () => {};
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      rendererCanvas.removeEventListener("pointermove", pointerMove);
      rendererCanvas.removeEventListener("pointerleave", pointerLeave);
      rendererCanvas.removeEventListener("pointerdown", pointerDown);
      rendererCanvas.removeEventListener("pointerup", pointerUp);
      rendererCanvas.removeEventListener("pointercancel", pointerLeave);
      rendererCanvas.removeEventListener("webglcontextlost", onContextLost);
      rendererCanvas.removeEventListener("webglcontextrestored", onContextRestored);
      document.removeEventListener("visibilitychange", visibilityChange);
      reducedMotion.removeEventListener("change", requestFrame);
      pins.dispose();
      bands.dispose();
      geometries.forEach((value) => value.dispose());
      materials.forEach((value) => value.dispose());
      textures.forEach((value) => value.dispose());
      bloom.dispose();
      outputPass.dispose();
      renderPass.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      rendererCanvas.remove();
      unavailableNotice.remove();
    };
  }, []);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }} />;
}
