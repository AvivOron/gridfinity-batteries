import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface ViewerProps {
  geometry: THREE.BufferGeometry | null;
}

export default function Viewer({ geometry }: ViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070d);
    scene.fog = new THREE.Fog(0x05070d, 300, 900);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 2000);
    camera.position.set(150, 150, 180);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 20, 0);
    controls.enableDamping = true;
    controlsRef.current = controls;

    const hemi = new THREE.HemisphereLight(0x8fb8ff, 0x0a0e18, 1.1);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(100, 200, 100);
    scene.add(dir);
    const rim = new THREE.DirectionalLight(0x4fd1ff, 0.5);
    rim.position.set(-150, 80, -100);
    scene.add(rim);

    const grid = new THREE.GridHelper(400, 40, 0x2a3550, 0x141a2c);
    scene.add(grid);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      (meshRef.current.material as THREE.Material).dispose();
      meshRef.current = null;
    }

    if (geometry) {
      const material = new THREE.MeshStandardMaterial({
        color: 0x3d6fe0,
        roughness: 0.4,
        metalness: 0.25,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = false;
      scene.add(mesh);
      meshRef.current = mesh;

      geometry.computeBoundingBox();
      const bbox = geometry.boundingBox;
      if (bbox && cameraRef.current && controlsRef.current) {
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        controlsRef.current.target.copy(center);
        const dist = maxDim * 1.8 + 40;
        cameraRef.current.position.set(center.x + dist * 0.6, center.y + dist * 0.6, center.z + dist * 0.7);
        cameraRef.current.near = 0.1;
        cameraRef.current.far = dist * 10;
        cameraRef.current.updateProjectionMatrix();
      }
    }
  }, [geometry]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
