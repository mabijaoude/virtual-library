import { Fragment, isValidElement, type ReactNode } from "react";
import * as THREE from "three";

export type SceneTestHooks = {
  effects: Array<() => void | (() => void)>;
  frames: Array<(state: { clock: { elapsedTime: number } }, delta: number) => void>;
};

// A deliberately small JSX mount for CPU geometry tests. Effects populate the
// actual instance matrices; frame callbacks animate the actual component refs.
// Unsupported elements fail explicitly instead of silently omitting geometry.
export function mountTestScene(render: () => ReactNode, hooks: SceneTestHooks) {
  hooks.effects.length = hooks.frames.length = 0;
  const root = new THREE.Group();
  const append = (node: ReactNode, parent: THREE.Object3D) => {
    if (Array.isArray(node)) { node.forEach((child) => append(child, parent)); return; }
    if (!isValidElement(node)) return;
    const props = node.props as Record<string, unknown>;
    if (node.type === Fragment) { append(props.children as ReactNode, parent); return; }
    if (typeof node.type === "function") {
      append((node.type as (props: Record<string, unknown>) => ReactNode)(props), parent);
      return;
    }
    const type = String(node.type);
    const args = (props.args ?? []) as unknown[];
    const constructors = { boxGeometry: THREE.BoxGeometry, cylinderGeometry: THREE.CylinderGeometry,
      torusGeometry: THREE.TorusGeometry, sphereGeometry: THREE.SphereGeometry, circleGeometry: THREE.CircleGeometry,
      planeGeometry: THREE.PlaneGeometry, latheGeometry: THREE.LatheGeometry, icosahedronGeometry: THREE.IcosahedronGeometry };
    if (type in constructors || type === "primitive") {
      const Constructor = constructors[type as keyof typeof constructors] as unknown as new (...args: unknown[]) => THREE.BufferGeometry;
      const geometry = type === "primitive" ? props.object : new Constructor(...args);
      if (!(geometry instanceof THREE.BufferGeometry) || type === "primitive" && props.attach !== "geometry") {
        throw new Error("Scene geometry tests only support geometry primitives");
      }
      (parent as THREE.Mesh).geometry.dispose();
      (parent as THREE.Mesh).geometry = geometry;
      return;
    }
    if (type === "meshStandardMaterial" || type === "meshBasicMaterial" || type === "meshPhysicalMaterial" || type === "shaderMaterial") {
      const parameters = Object.fromEntries(Object.entries(props).filter(([key, value]) => key !== "children" && value !== undefined));
      ((parent as THREE.Mesh).material as THREE.Material).dispose();
      (parent as THREE.Mesh).material = type === "meshStandardMaterial" ? new THREE.MeshStandardMaterial(parameters)
        : type === "meshPhysicalMaterial" ? new THREE.MeshPhysicalMaterial(parameters)
          : type === "shaderMaterial" ? new THREE.ShaderMaterial(parameters) : new THREE.MeshBasicMaterial(parameters);
      return;
    }
    const object = type === "group" ? new THREE.Group()
      : type === "mesh" ? new THREE.Mesh()
        : type === "instancedMesh" ? new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), Number(args[2]))
          : type === "pointLight" ? new THREE.PointLight(String(props.color), Number(props.intensity), Number(props.distance), Number(props.decay))
            : undefined;
    if (!object) throw new Error(`Unsupported scene JSX element: ${type}`);
    for (const name of ["position", "scale", "rotation"] as const) {
      const value = props[name];
      if (Array.isArray(value)) {
        if (name === "rotation") object.rotation.set(value[0], value[1], value[2]);
        else object[name].fromArray(value);
      }
      for (const axis of ["x", "y", "z"] as const) {
        const axisValue = props[`${name}-${axis}`];
        if (typeof axisValue === "number") object[name][axis] = axisValue;
      }
    }
    object.castShadow = props.castShadow === true;
    object.receiveShadow = props.receiveShadow === true;
    object.name = String(props.name ?? type);
    object.userData = (props.userData ?? {}) as Record<string, unknown>;
    if (props.ref) (props.ref as { current: THREE.Object3D }).current = object;
    parent.add(object);
    append(props.children as ReactNode, object);
  };
  append(render(), root);
  const cleanups = hooks.effects.map((effect) => effect());
  const frames = [...hooks.frames];
  const step = (delta: number, elapsedTime = 0) => {
    frames.forEach((frame) => frame({ clock: { elapsedTime } }, delta));
    root.updateMatrixWorld(true);
  };
  step(0);
  return { root, step, dispose: () => {
    cleanups.forEach((cleanup) => cleanup?.());
    for (const mesh of sceneMeshes(root)) {
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    }
  } };
}

export function sceneMeshes(root: THREE.Object3D) {
  const result: THREE.Mesh[] = [];
  root.traverse((object) => { if (object instanceof THREE.Mesh) result.push(object); });
  return result;
}

export function sceneParts(root: THREE.Object3D) {
  return sceneMeshes(root).flatMap((mesh, meshIndex) => {
    mesh.geometry.computeBoundingBox();
    const count = mesh instanceof THREE.InstancedMesh ? mesh.count : 1;
    return Array.from({ length: count }, (_, index) => {
      const matrix = new THREE.Matrix4();
      if (mesh instanceof THREE.InstancedMesh) mesh.getMatrixAt(index, matrix);
      matrix.premultiply(mesh.matrixWorld);
      return { label: `${mesh.name} ${meshIndex}, instance ${index}`, mesh, index,
        box: mesh.geometry.boundingBox!.clone().applyMatrix4(matrix), matrix };
    });
  });
}
