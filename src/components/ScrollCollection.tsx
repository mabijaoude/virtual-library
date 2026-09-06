import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { isTapGesture } from "../navigation";
import type { Book } from "../types";
import { resolveBookTransform } from "../worlds/layout";
import type { ResolvedQuality, WorldDefinition } from "../worlds/types";

type Props = {
  books: Book[];
  world: WorldDefinition;
  selectedBookId?: string;
  quality: ResolvedQuality;
  highlights: Map<string, number>;
  onSelectBook: (book: Book) => void;
  onHoverBook: (book?: Book) => void;
  onReady?: () => void;
};

const PAGE_SIZE = 70;

export function ScrollCollection({ books, world, selectedBookId, quality, highlights, onSelectBook, onHoverBook, onReady }: Props) {
  const { camera, gl } = useThree();
  const rollRef = useRef<THREE.InstancedMesh>(null);
  const rodRef = useRef<THREE.InstancedMesh>(null);
  const windingRef = useRef<THREE.InstancedMesh>(null);
  const innerWindingRef = useRef<THREE.InstancedMesh>(null);
  const looseLeafRef = useRef<THREE.InstancedMesh>(null);
  const knobRef = useRef<THREE.InstancedMesh>(null);
  const cordRef = useRef<THREE.InstancedMesh>(null);
  const bindingRef = useRef<THREE.InstancedMesh>(null);
  const tagRefs = useRef<Array<THREE.InstancedMesh | null>>([]);
  const [hoveredId, setHoveredId] = useState<string>();
  const outwards = useRef(new Float32Array(books.length));
  const pointer = useRef<{ pointerId: number; origin: { x: number; y: number } } | undefined>(undefined);
  const animationActive = useRef(true);
  const transforms = useMemo(() => books.map((book) => resolveBookTransform(book.placement, world)), [books, world]);
  const [papyrusMap, papyrusNormal, papyrusRoughness] = useTexture([
    "/worlds/assets/materials/alexandria-papyrus-color.webp",
    "/worlds/assets/materials/alexandria-papyrus-normal.webp",
    "/worlds/assets/materials/alexandria-papyrus-roughness.webp"
  ]);
  const cylinder = useMemo(() => createPapyrusRollGeometry(quality === "lite" ? 14 : 26, quality === "lite" ? 2 : 5), [quality]);
  const rod = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, quality === "lite" ? 10 : 16, 1, false);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }, [quality]);
  const winding = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, quality === "lite" ? 12 : 22, 1, false);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }, [quality]);
  const looseLeaf = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(0.507, 0.507, 1, quality === "lite" ? 12 : 24, 1, true, -0.68, 1.36);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }, [quality]);
  const knob = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(0.42, 0.68, 1, quality === "lite" ? 10 : 18, 1, false);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }, [quality]);
  const cord = useMemo(() => new THREE.CylinderGeometry(0.5, 0.5, 1, 8), []);
  const binding = useMemo(() => new THREE.TorusGeometry(0.5, 0.026, quality === "lite" ? 5 : 7, quality === "lite" ? 12 : 20), [quality]);
  const windingTexture = useMemo(() => createPapyrusWindingTexture(), []);
  const pages = useMemo(() => {
    const result = [];
    for (let offset = 0; offset < books.length; offset += PAGE_SIZE) {
      const pageBooks = books.slice(offset, offset + PAGE_SIZE);
      const atlas = createScrollAtlas(pageBooks, world);
      const geometry = new THREE.PlaneGeometry(1, 1);
      geometry.setAttribute("instanceUvOffset", new THREE.InstancedBufferAttribute(atlas.offsets, 2));
      geometry.setAttribute("instanceUvScale", new THREE.InstancedBufferAttribute(atlas.scales, 2));
      result.push({ offset, books: pageBooks, atlas, geometry, material: createAtlasMaterial(atlas.texture) });
    }
    return result;
  }, [books, world]);
  const scratch = useMemo(() => ({
    matrix: new THREE.Matrix4(),
    quaternion: new THREE.Quaternion(),
    euler: new THREE.Euler(),
    position: new THREE.Vector3(),
    scale: new THREE.Vector3()
  }), []);

  useEffect(() => {
    papyrusMap.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [papyrusMap, papyrusNormal, papyrusRoughness]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(2.4, 1.25);
      texture.anisotropy = quality === "lite" ? 2 : 8;
      texture.needsUpdate = true;
    }
    windingTexture.anisotropy = quality === "lite" ? 2 : 8;
    windingTexture.needsUpdate = true;
  }, [papyrusMap, papyrusNormal, papyrusRoughness, quality, windingTexture]);
  useEffect(() => {
    outwards.current = new Float32Array(books.length);
    tagRefs.current.length = pages.length;
    animationActive.current = true;
  }, [books.length, pages.length, transforms]);
  useEffect(() => { animationActive.current = true; }, [highlights, hoveredId, selectedBookId]);
  useEffect(() => {
    gl.domElement.dataset.displayArtifacts = "scrolls";
    gl.domElement.dataset.interactiveBooks = String(books.length);
    gl.domElement.dataset.scrollAtlasPages = String(pages.length);
    return () => { delete gl.domElement.dataset.displayArtifacts; };
  }, [books.length, gl.domElement, pages.length]);
  useEffect(() => onReady?.(), [onReady, pages]);
  useEffect(() => {
    books.forEach((book, index) => {
      const presentation = scrollPresentation(book.id);
      const parchment = new THREE.Color(presentation.parchmentColor);
      const strength = highlights.get(book.id) || 0;
      if (strength) parchment.lerp(new THREE.Color(world.scene.secondary), 0.18 + strength * 0.28);
      rollRef.current?.setColorAt(index, parchment);
      looseLeafRef.current?.setColorAt(index, parchment.clone().offsetHSL(-0.01, -0.035, 0.055));
      const wood = new THREE.Color(presentation.woodColor);
      rodRef.current?.setColorAt(index, wood);
      cordRef.current?.setColorAt(index, new THREE.Color(presentation.cordColor));
      for (const side of [0, 1]) {
        const edgeIndex = index * 2 + side;
        windingRef.current?.setColorAt(edgeIndex, parchment.clone().offsetHSL(0, -0.04, side ? -0.025 : 0.018));
        innerWindingRef.current?.setColorAt(edgeIndex, parchment.clone().offsetHSL(0.015, 0.08, -0.16));
        knobRef.current?.setColorAt(edgeIndex, wood);
        bindingRef.current?.setColorAt(edgeIndex, new THREE.Color(presentation.bindingColor));
      }
    });
    if (rollRef.current?.instanceColor) rollRef.current.instanceColor.needsUpdate = true;
    if (looseLeafRef.current?.instanceColor) looseLeafRef.current.instanceColor.needsUpdate = true;
    if (rodRef.current?.instanceColor) rodRef.current.instanceColor.needsUpdate = true;
    if (cordRef.current?.instanceColor) cordRef.current.instanceColor.needsUpdate = true;
    if (windingRef.current?.instanceColor) windingRef.current.instanceColor.needsUpdate = true;
    if (innerWindingRef.current?.instanceColor) innerWindingRef.current.instanceColor.needsUpdate = true;
    if (knobRef.current?.instanceColor) knobRef.current.instanceColor.needsUpdate = true;
    if (bindingRef.current?.instanceColor) bindingRef.current.instanceColor.needsUpdate = true;
  }, [books, highlights, world.scene.secondary]);
  useEffect(() => () => {
    cylinder.dispose();
    rod.dispose();
    winding.dispose();
    looseLeaf.dispose();
    knob.dispose();
    cord.dispose();
    binding.dispose();
    windingTexture.dispose();
  }, [cylinder, rod, winding, looseLeaf, knob, cord, binding, windingTexture]);
  useEffect(() => () => pages.forEach((page) => {
    page.atlas.texture.dispose();
    page.geometry.dispose();
    page.material.dispose();
  }), [pages]);

  useFrame((_, delta) => {
    if (!animationActive.current) return;
    const { matrix, quaternion, euler, position, scale } = scratch;
    let largestChange = 0;
    books.forEach((book, index) => {
      const transform = transforms[index];
      const hidden = book.id === selectedBookId;
      const targetOut = book.id === hoveredId ? 0.2 : highlights.has(book.id) ? 0.06 : 0;
      const previous = outwards.current[index] || 0;
      outwards.current[index] = THREE.MathUtils.damp(previous, targetOut, 10, delta);
      largestChange = Math.max(largestChange, Math.abs(previous - outwards.current[index]));
      const visibility = hidden ? 0.0001 : 1;
      const presentation = scrollPresentation(book.id);
      const diameter = scrollDiameter(book);
      const depth = presentation.depth;
      const tag = presentation.tag;
      position.copy(transform.position).addScaledVector(transform.front, outwards.current[index] - presentation.recess);
      position.y += presentation.verticalOffset;
      quaternion.setFromEuler(euler.set(0, transform.rotationY, presentation.tilt, "YXZ"));
      scale.set(diameter * visibility, diameter * visibility, depth * visibility);
      matrix.compose(position, quaternion, scale);
      rollRef.current?.setMatrixAt(index, matrix);

      const leafVisibility = presentation.hasLooseWrap && !hidden ? 1 : 0.0001;
      scale.set(diameter * 1.025 * leafVisibility, diameter * 1.025 * leafVisibility, depth * presentation.looseWrapLength * leafVisibility);
      matrix.compose(position, quaternion, scale);
      looseLeafRef.current?.setMatrixAt(index, matrix);

      scale.set(presentation.rodRadius * visibility, presentation.rodRadius * visibility, (depth + presentation.rodExtension) * visibility);
      matrix.compose(position, quaternion, scale);
      rodRef.current?.setMatrixAt(index, matrix);

      for (const side of [-1, 1]) {
        const detailIndex = index * 2 + (side > 0 ? 1 : 0);
        position.copy(transform.position).addScaledVector(transform.front, outwards.current[index] - presentation.recess + side * (depth / 2 + 0.009));
        position.y += presentation.verticalOffset;
        scale.set(diameter * presentation.windingScale * visibility, diameter * presentation.windingScale * visibility, presentation.windingDepth * visibility);
        matrix.compose(position, quaternion, scale);
        windingRef.current?.setMatrixAt(detailIndex, matrix);
        scale.set(diameter * presentation.innerWindingScale * visibility, diameter * presentation.innerWindingScale * visibility, 0.034 * visibility);
        matrix.compose(position, quaternion, scale);
        innerWindingRef.current?.setMatrixAt(detailIndex, matrix);
        position.addScaledVector(transform.front, side * presentation.knobLength);
        scale.set(presentation.knobRadius * visibility, presentation.knobRadius * visibility, presentation.knobLength * visibility);
        matrix.compose(position, quaternion, scale);
        knobRef.current?.setMatrixAt(detailIndex, matrix);

        const bindingVisibility = presentation.hasBinding && !hidden ? 1 : 0.0001;
        position.copy(transform.position).addScaledVector(transform.front, outwards.current[index] - presentation.recess + side * depth * presentation.bindingPosition);
        position.y += presentation.verticalOffset;
        scale.set(diameter * 1.035 * bindingVisibility, diameter * 1.035 * bindingVisibility, diameter * 1.035 * bindingVisibility);
        matrix.compose(position, quaternion, scale);
        bindingRef.current?.setMatrixAt(detailIndex, matrix);
      }

      const frontOffset = outwards.current[index] + depth / 2 + 0.105;
      const tagCenterY = transform.position.y - diameter / 2 - tag.cord - tag.height / 2 + 0.015;
      position.copy(transform.position).addScaledVector(transform.front, frontOffset);
      position.y = transform.position.y - diameter / 2 - tag.cord / 2 + 0.01;
      scale.set(0.012 * visibility, tag.cord * visibility, 0.012 * visibility);
      matrix.compose(position, quaternion, scale);
      cordRef.current?.setMatrixAt(index, matrix);

      position.copy(transform.position).addScaledVector(transform.front, frontOffset + 0.008);
      position.y += presentation.verticalOffset;
      position.y = tagCenterY;
      scale.set(tag.width * visibility, tag.height * visibility, 1);
      matrix.compose(position, quaternion, scale);
      const pageIndex = Math.floor(index / PAGE_SIZE);
      const page = pages[pageIndex];
      tagRefs.current[pageIndex]?.setMatrixAt(index - page.offset, matrix);

    });
    if (rollRef.current) rollRef.current.instanceMatrix.needsUpdate = true;
    if (looseLeafRef.current) looseLeafRef.current.instanceMatrix.needsUpdate = true;
    if (rodRef.current) rodRef.current.instanceMatrix.needsUpdate = true;
    if (windingRef.current) windingRef.current.instanceMatrix.needsUpdate = true;
    if (innerWindingRef.current) innerWindingRef.current.instanceMatrix.needsUpdate = true;
    if (knobRef.current) knobRef.current.instanceMatrix.needsUpdate = true;
    if (cordRef.current) cordRef.current.instanceMatrix.needsUpdate = true;
    if (bindingRef.current) bindingRef.current.instanceMatrix.needsUpdate = true;
    tagRefs.current.forEach((mesh) => { if (mesh) mesh.instanceMatrix.needsUpdate = true; });
    if (largestChange < 0.00002) animationActive.current = false;
  });

  const bookForEvent = (event: ThreeEvent<PointerEvent>) => {
    if (typeof event.instanceId !== "number") return undefined;
    return books[Number(event.object.userData.bookIndexOffset || 0) + event.instanceId];
  };
  const handleOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const book = bookForEvent(event);
    if (!book) return;
    setHoveredId(book.id);
    onHoverBook(book);
    document.body.style.cursor = "pointer";
  };
  const handleOut = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    setHoveredId(undefined);
    onHoverBook(undefined);
    document.body.style.cursor = "";
  };

  useEffect(() => {
    const start = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointer.current = { pointerId: event.pointerId, origin: { x: event.clientX, y: event.clientY } };
    };
    const finish = (event: PointerEvent) => {
      const pressed = pointer.current;
      if (!pressed || pressed.pointerId !== event.pointerId) return;
      pointer.current = undefined;
      if (!isTapGesture(pressed.origin, { x: event.clientX, y: event.clientY })) return;
      const rect = gl.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const targets = [...tagRefs.current, rollRef.current].filter((target): target is THREE.InstancedMesh => Boolean(target));
      const hit = ray.intersectObjects(targets, false).find((entry) => typeof entry.instanceId === "number");
      const offset = Number(hit?.object.userData.bookIndexOffset || 0);
      const book = typeof hit?.instanceId === "number" ? books[offset + hit.instanceId] : undefined;
      gl.domElement.dataset.bookTapHit = book?.id || "none";
      if (book) onSelectBook(book);
    };
    const cancel = (event: PointerEvent) => { if (pointer.current?.pointerId === event.pointerId) pointer.current = undefined; };
    gl.domElement.addEventListener("pointerdown", start);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      gl.domElement.removeEventListener("pointerdown", start);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [books, camera, gl.domElement, onSelectBook]);

  const selectedBook = books.find((book) => book.id === selectedBookId);
  return (
    <group>
      <instancedMesh ref={rollRef} args={[cylinder, undefined, books.length]} frustumCulled={false} castShadow={quality === "cinematic"} receiveShadow onPointerOver={handleOver} onPointerOut={handleOut} userData={{ bookIndexOffset: 0 }}>
        <meshPhysicalMaterial map={papyrusMap} normalMap={papyrusNormal} normalScale={new THREE.Vector2(0.88, 0.88)} roughnessMap={papyrusRoughness} emissiveMap={papyrusMap} emissive="#d9ae70" emissiveIntensity={0.1} vertexColors roughness={0.94} clearcoat={0.002} sheen={0.12} sheenColor="#f4d7a1" envMapIntensity={0.42} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={looseLeafRef} args={[looseLeaf, undefined, books.length]} frustumCulled={false} castShadow={quality === "cinematic"}>
        <meshPhysicalMaterial map={papyrusMap} normalMap={papyrusNormal} normalScale={new THREE.Vector2(0.95, 0.95)} roughnessMap={papyrusRoughness} emissiveMap={papyrusMap} emissive="#e3bd80" emissiveIntensity={0.11} vertexColors roughness={0.97} sheen={0.1} sheenColor="#f2d49d" envMapIntensity={0.38} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={rodRef} args={[rod, undefined, books.length]} frustumCulled={false} castShadow={quality === "cinematic"}>
        <meshStandardMaterial vertexColors roughness={0.52} />
      </instancedMesh>
      <instancedMesh ref={windingRef} args={[winding, undefined, books.length * 2]} frustumCulled={false} castShadow={quality === "cinematic"}>
        <meshStandardMaterial map={windingTexture} vertexColors color="#fff7df" emissiveMap={windingTexture} emissive="#fff0cc" emissiveIntensity={0.22} roughness={0.97} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={innerWindingRef} args={[winding, undefined, books.length * 2]} frustumCulled={false}>
        <meshStandardMaterial vertexColors color="#fff0c6" emissive="#f6d69a" emissiveIntensity={0.16} roughness={0.98} />
      </instancedMesh>
      <instancedMesh ref={knobRef} args={[knob, undefined, books.length * 2]} frustumCulled={false} castShadow={quality === "cinematic"}>
        <meshStandardMaterial vertexColors roughness={0.48} />
      </instancedMesh>
      <instancedMesh ref={cordRef} args={[cord, undefined, books.length]} frustumCulled={false}>
        <meshStandardMaterial vertexColors roughness={1} />
      </instancedMesh>
      <instancedMesh ref={bindingRef} args={[binding, undefined, books.length * 2]} frustumCulled={false} castShadow={quality === "cinematic"}>
        <meshStandardMaterial vertexColors roughness={1} />
      </instancedMesh>
      {pages.map((page, index) => (
        <instancedMesh
          key={page.offset}
          ref={(mesh) => { tagRefs.current[index] = mesh; }}
          args={[page.geometry, page.material, page.books.length]}
          userData={{ bookIndexOffset: page.offset }}
          frustumCulled={false}
          onPointerOver={handleOver}
          onPointerOut={handleOut}
        />
      ))}
      {selectedBook && <HeroScroll book={selectedBook} world={world} quality={quality} papyrusMaps={{ map: papyrusMap, normalMap: papyrusNormal, roughnessMap: papyrusRoughness }} windingMap={windingTexture} />}
    </group>
  );
}

function HeroScroll({ book, world, quality, papyrusMaps, windingMap }: {
  book: Book;
  world: WorldDefinition;
  quality: ResolvedQuality;
  papyrusMaps: { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture };
  windingMap: THREE.Texture;
}) {
  const group = useRef<THREE.Group>(null);
  const transform = useMemo(() => resolveBookTransform(book.placement, world), [book, world]);
  const texture = useMemo(() => createSingleTagTexture(book, world), [book, world]);
  const presentation = scrollPresentation(book.id);
  const diameter = scrollDiameter(book);
  const depth = presentation.depth + 0.06;
  const tag = presentation.tag;
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame((_, delta) => {
    if (!group.current) return;
    const target = transform.position.clone().addScaledVector(transform.front, 0.42);
    group.current.position.lerp(target, 1 - Math.exp(-delta * 9));
    group.current.scale.lerp(new THREE.Vector3(1.12, 1.12, 1.12), 1 - Math.exp(-delta * 8));
  });
  return (
    <group ref={group} position={transform.position} rotation={[0, transform.rotationY, presentation.tilt]}>
      <mesh rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[diameter / 2, diameter / 2, depth, quality === "lite" ? 16 : 32]} />
        <meshPhysicalMaterial {...papyrusMaps} emissiveMap={papyrusMaps.map} normalScale={new THREE.Vector2(0.9, 0.9)} color={presentation.parchmentColor} emissive="#d9ae70" emissiveIntensity={0.1} roughness={0.94} clearcoat={0.002} sheen={0.12} sheenColor="#f4d7a1" envMapIntensity={0.42} />
      </mesh>
      {presentation.hasLooseWrap && (
        <mesh rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[diameter * 0.507, diameter * 0.507, depth * presentation.looseWrapLength, quality === "lite" ? 14 : 30, 1, true, -0.68, 1.36]} />
          <meshPhysicalMaterial {...papyrusMaps} emissiveMap={papyrusMaps.map} normalScale={new THREE.Vector2(0.96, 0.96)} color={presentation.parchmentColor} emissive="#e3bd80" emissiveIntensity={0.11} roughness={0.97} sheen={0.1} sheenColor="#f2d49d" envMapIntensity={0.38} side={THREE.DoubleSide} />
        </mesh>
      )}
      <mesh rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[presentation.rodRadius / 2, presentation.rodRadius / 2, depth + presentation.rodExtension, 18]} />
        <meshStandardMaterial color={presentation.woodColor} roughness={0.5} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position={[0, 0, side * (depth / 2 + 0.012)]}>
          <mesh rotation-x={Math.PI / 2} castShadow>
            <cylinderGeometry args={[diameter * 0.515, diameter * 0.515, 0.028, quality === "lite" ? 14 : 30]} />
            <meshStandardMaterial map={windingMap} color={side > 0 ? presentation.parchmentColor : presentation.windingColor} roughness={0.96} />
          </mesh>
          <mesh position={[0, 0, side * 0.018]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[diameter * 0.31, diameter * 0.045, quality === "lite" ? 6 : 10, quality === "lite" ? 18 : 32]} />
            <meshStandardMaterial color={presentation.windingColor} roughness={0.98} />
          </mesh>
          <mesh position={[0, 0, side * 0.105]} rotation-x={Math.PI / 2} castShadow>
            <cylinderGeometry args={[presentation.knobRadius * 0.55, presentation.knobRadius, presentation.knobLength, 18]} />
            <meshStandardMaterial color={presentation.woodColor} roughness={0.48} />
          </mesh>
        </group>
      ))}
      {presentation.hasBinding && [-1, 1].map((side) => (
        <mesh key={`binding-${side}`} position={[0, 0, side * depth * presentation.bindingPosition]}>
          <torusGeometry args={[diameter * 0.505, diameter * 0.014, quality === "lite" ? 5 : 7, quality === "lite" ? 12 : 20]} />
          <meshStandardMaterial color={presentation.bindingColor} roughness={1} />
        </mesh>
      ))}
      <mesh position={[0, -diameter / 2 - tag.cord / 2 + 0.01, depth / 2 + 0.105]}>
        <cylinderGeometry args={[0.006, 0.006, tag.cord, 8]} />
        <meshStandardMaterial color={presentation.cordColor} roughness={1} />
      </mesh>
      <mesh position={[0, -diameter / 2 - tag.cord - tag.height / 2 + 0.015, depth / 2 + 0.114]}>
        <planeGeometry args={[tag.width, tag.height]} />
        <meshStandardMaterial map={texture} roughness={0.92} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function createScrollAtlas(books: Book[], world: WorldDefinition) {
  const columns = 10;
  const rows = Math.max(1, Math.ceil(books.length / columns));
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 1024;
  const offsets = new Float32Array(books.length * 2);
  const scales = new Float32Array(books.length * 2);
  books.forEach((book, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    offsets[index * 2] = column / columns;
    offsets[index * 2 + 1] = 1 - (row + 1) / rows;
    scales[index * 2] = 1 / columns;
    scales[index * 2 + 1] = 1 / rows;
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const atlas = { canvas, columns, rows, texture, offsets, scales };
  const ctx = canvas.getContext("2d")!;
  const tileWidth = canvas.width / columns;
  const tileHeight = canvas.height / rows;
  books.forEach((book, index) => drawTag(ctx, (index % columns) * tileWidth, Math.floor(index / columns) * tileHeight, tileWidth, tileHeight, book, world));
  texture.needsUpdate = true;
  return atlas;
}

function createSingleTagTexture(book: Book, world: WorldDefinition) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 960;
  drawTag(canvas.getContext("2d")!, 0, 0, canvas.width, canvas.height, book, world);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  return texture;
}

function createPapyrusWindingTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const center = size / 2;
  const base = ctx.createRadialGradient(center - 20, center - 26, 8, center, center, center);
  base.addColorStop(0, "#c4914e");
  base.addColorStop(0.16, "#e1bd79");
  base.addColorStop(0.55, "#f2dfae");
  base.addColorStop(1, "#dfbd78");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let radius = 22; radius < center * 0.98; radius += 6.5) {
    const wobble = Math.sin(radius * 0.11) * 1.7;
    ctx.beginPath();
    ctx.ellipse(center + Math.sin(radius) * 1.2, center + Math.cos(radius * 0.7) * 1.1, radius + wobble, radius - wobble * 0.6, radius * 0.0018, 0, Math.PI * 2);
    ctx.strokeStyle = radius % 13 < 6.5 ? "rgba(101,61,25,.25)" : "rgba(255,246,207,.34)";
    ctx.lineWidth = radius % 26 < 13 ? 2.3 : 1.2;
    ctx.stroke();
  }
  for (let index = 0; index < 90; index += 1) {
    const angle = index * 2.39996;
    const radius = 18 + ((index * 47) % 220);
    ctx.fillStyle = index % 3 ? "rgba(91,54,23,.08)" : "rgba(255,241,198,.12)";
    ctx.fillRect(center + Math.cos(angle) * radius, center + Math.sin(angle) * radius, 1 + index % 2, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function drawTag(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, book: Book, world: WorldDefinition) {
  ctx.save();
  const seed = hashString(book.id);
  const presentation = scrollPresentation(book.id);
  const parchment = ["#ead49a", "#f2e1b0", "#e5c98c", "#f0d8a1", "#e8d5a5", "#f3e5bd"][presentation.archetype % 6];
  ctx.fillStyle = parchment;
  ctx.fillRect(x, y, width, height);
  const edgeShade = ctx.createLinearGradient(x, y, x + width, y);
  edgeShade.addColorStop(0, "rgba(95,53,20,.18)");
  edgeShade.addColorStop(0.12, "rgba(255,248,215,.08)");
  edgeShade.addColorStop(0.84, "rgba(255,248,215,.04)");
  edgeShade.addColorStop(1, "rgba(95,53,20,.2)");
  ctx.fillStyle = edgeShade;
  ctx.fillRect(x, y, width, height);
  for (let py = 0; py < height; py += 3) {
    const alpha = 5 + ((py + seed) % 7);
    ctx.fillStyle = `rgba(105,72,31,${alpha / 255})`;
    ctx.fillRect(x, y + py, width, 1);
  }
  const edge = width * 0.045;
  const borderPair = presentation.family % 2 === 0 ? ["#315f72", "#9f5b36"] : ["#875126", "#315f72"];
  ctx.fillStyle = borderPair[0];
  ctx.fillRect(x, y, edge, height);
  ctx.fillStyle = borderPair[1];
  ctx.fillRect(x + width - edge, y, edge, height);
  ctx.strokeStyle = "rgba(82,47,18,.68)";
  ctx.lineWidth = Math.max(1, width * 0.014);
  ctx.strokeRect(x + edge * 1.65, y + edge * 1.1, width - edge * 3.3, height - edge * 2.2);
  ctx.fillStyle = world.scene.accent;
  ctx.fillRect(x + width * 0.18, y + height * 0.075, width * 0.64, Math.max(1, height * 0.012));
  const innerWidth = width * 0.75;
  const maxTitleHeight = height * 0.66;
  let size = width * 0.155;
  let lines: string[] = [];
  const minimumSize = Math.max(5, width * 0.045);
  while (size >= minimumSize) {
    ctx.font = `700 ${size}px Georgia, serif`;
    lines = wrapText(ctx, book.title, innerWidth);
    if (lines.length * size * 1.12 <= maxTitleHeight) break;
    size -= 0.5;
  }
  ctx.fillStyle = "#35200e";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lineHeight = size * 1.1;
  const titleCenter = y + height * 0.47;
  lines.forEach((line, index) => ctx.fillText(line, x + width / 2, titleCenter + (index - (lines.length - 1) / 2) * lineHeight));
  ctx.font = `600 ${Math.max(width * 0.032, size * 0.66)}px "Segoe UI", sans-serif`;
  ctx.fillStyle = "#6d4726";
  ctx.fillText(book.author || "Unknown Author", x + width / 2, y + height * 0.885, innerWidth);
  ctx.restore();
}

function createAtlasMaterial(texture: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: { atlas: { value: texture } },
    vertexShader: `
      attribute vec2 instanceUvOffset;
      attribute vec2 instanceUvScale;
      varying vec2 atlasUv;
      varying vec2 atlasOffset;
      varying vec2 atlasScale;
      void main() {
        atlasOffset = instanceUvOffset;
        atlasScale = instanceUvScale;
        atlasUv = instanceUvOffset + uv * instanceUvScale;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D atlas;
      varying vec2 atlasUv;
      varying vec2 atlasOffset;
      varying vec2 atlasScale;
      void main() {
        vec2 sampleUv = atlasUv;
        if (!gl_FrontFacing) sampleUv.x = atlasOffset.x + atlasScale.x - (atlasUv.x - atlasOffset.x);
        gl_FragColor = texture2D(atlas, sampleUv);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide
  });
}

function wrapText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number) {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export type ScrollPresentation = {
  archetype: number;
  family: number;
  diameterBias: number;
  depth: number;
  rodRadius: number;
  rodExtension: number;
  windingScale: number;
  windingDepth: number;
  innerWindingScale: number;
  knobRadius: number;
  knobLength: number;
  recess: number;
  verticalOffset: number;
  tilt: number;
  parchmentColor: string;
  windingColor: string;
  woodColor: string;
  cordColor: string;
  hasLooseWrap: boolean;
  looseWrapLength: number;
  hasBinding: boolean;
  bindingPosition: number;
  bindingColor: string;
  tag: { width: number; height: number; cord: number };
};

const PAPYRUS_TONES = ["#f3dba6", "#e7c489", "#f1d49a", "#dcb477", "#efd09a", "#e3bc82", "#f6e1b2", "#d4a76a", "#ebca91", "#f8e7bd"];
const WINDING_TONES = ["#e8c680", "#d9a85d", "#f0d69b", "#c98a43", "#efd9aa", "#d7aa68", "#f5e1b3", "#c99750"];
const ROD_TONES = ["#754321", "#945d30", "#5e351e", "#a36d3c", "#7e4e2a", "#ae7440", "#684026", "#8b572f"];
const CORD_TONES = ["#8a6033", "#6d4526", "#a17846", "#735332"];
const BINDING_TONES = ["#79532f", "#aa7c45", "#684428", "#bea06d", "#89613a"];

export function scrollPresentation(id: string): ScrollPresentation {
  const hash = hashString(id);
  const archetype = hash % 24;
  const family = archetype % 4;
  const age = Math.floor(archetype / 4);
  const breadth = ((hash >>> 8) % 5) - 2;
  const heightBias = ((hash >>> 13) % 5) - 2;
  return {
    archetype,
    family,
    diameterBias: [-0.006, 0.004, 0.012, -0.002][family] + age * 0.002,
    depth: [0.54, 0.61, 0.68, 0.58][family] + breadth * 0.008,
    rodRadius: [0.043, 0.049, 0.055, 0.046][family],
    rodExtension: [0.19, 0.23, 0.27, 0.21][family],
    windingScale: [1.02, 1.05, 1.075, 1.035][family],
    windingDepth: [0.024, 0.029, 0.034, 0.027][family],
    innerWindingScale: [0.22, 0.255, 0.29, 0.24][family],
    knobRadius: [0.029, 0.036, 0.043, 0.032][family],
    knobLength: [0.064, 0.078, 0.09, 0.071][family],
    recess: ((hash >>> 17) % 5) * 0.012,
    verticalOffset: heightBias * 0.006,
    tilt: (((hash >>> 20) % 9) - 4) * 0.008,
    parchmentColor: PAPYRUS_TONES[(archetype + age) % PAPYRUS_TONES.length],
    windingColor: WINDING_TONES[(archetype * 5) % WINDING_TONES.length],
    woodColor: ROD_TONES[(archetype * 7) % ROD_TONES.length],
    cordColor: CORD_TONES[(hash >>> 5) % CORD_TONES.length],
    hasLooseWrap: (hash >>> 9) % 4 === 0,
    looseWrapLength: [0.54, 0.68, 0.82, 0.61][family] + ((hash >>> 15) % 3) * 0.035,
    hasBinding: (hash >>> 12) % 7 === 0,
    bindingPosition: [0.2, 0.24, 0.28, 0.22][family],
    bindingColor: BINDING_TONES[(hash >>> 7) % BINDING_TONES.length],
    tag: {
      width: [0.128, 0.142, 0.157, 0.136][family] + age * 0.003,
      height: [0.3, 0.34, 0.385, 0.325][family] + age * 0.006,
      cord: [0.1, 0.126, 0.112, 0.146][family] + ((hash >>> 11) % 3) * 0.006
    }
  };
}

function createPapyrusRollGeometry(radialSegments: number, heightSegments: number) {
  const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, radialSegments, heightSegments, false);
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const radius = Math.hypot(x, z);
    if (radius < 0.2) continue;
    const angle = Math.atan2(z, x);
    const endInfluence = THREE.MathUtils.smoothstep(Math.abs(y), 0.2, 0.5);
    const ripple = (Math.sin(angle * 5 + y * 8.7) * 0.004 + Math.sin(angle * 11 - y * 4.1) * 0.0025) * (0.55 + endInfluence * 0.9);
    const radialScale = (radius + ripple) / radius;
    positions.setXYZ(index, x * radialScale, y, z * radialScale);
  }
  geometry.computeVertexNormals();
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function scrollDiameter(book: Book) {
  const presentation = scrollPresentation(book.id);
  return THREE.MathUtils.clamp(0.15 + (book.placement.height - 0.72) * 0.14 + presentation.diameterBias, 0.136, 0.215);
}

export function scrollVariant(id: string) {
  return scrollPresentation(id).archetype;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
