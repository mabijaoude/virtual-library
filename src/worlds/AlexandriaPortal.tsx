import { useEffect, useMemo } from "react";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { InstancedBoxes, InstancedCylinders } from "./shared";
import { ALEXANDRIA_ENTRANCE_DESIGN as design } from "./alexandriaEntrance";

type BoxTransform = Parameters<typeof InstancedBoxes>[0]["transforms"][number];

// An imagined Ptolemaic archive entrance, not a reconstruction of a surviving
// doorway. The generated shell owns the opening; this component owns its finish.
export function AlexandriaEntrance() {
  const source = useTexture({
    wood: "/worlds/assets/materials/shelf-wood-color.webp",
    woodNormal: "/worlds/assets/materials/shelf-wood-normal.webp",
    stone: "/worlds/assets/materials/marble-color.webp",
    stoneNormal: "/worlds/assets/materials/marble-normal.webp"
  });
  const maps = useMemo(() => {
    const result = Object.fromEntries(Object.entries(source).map(([key, value]) => {
      const map = value.clone();
      map.colorSpace = key.endsWith("Normal") ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(key.startsWith("wood") ? .65 : 1, key.startsWith("wood") ? 2.6 : 1.5);
      map.anisotropy = 4; map.needsUpdate = true;
      return [key, map];
    }));
    return result;
  }, [source]);
  useEffect(() => () => Object.values(maps).forEach(map => map.dispose()), [maps]);
  const layout = useMemo(() => {
    const stone: BoxTransform[] = [], wood: BoxTransform[] = [], trim: BoxTransform[] = [];
    const bronze: BoxTransform[] = [], studs: BoxTransform[] = [], paint: BoxTransform[] = [];
    const add = (list: BoxTransform[], x: number, y: number, z: number, w: number, h: number, d: number) => list.push({position:[x,y,z],scale:[w,h,d]});
    for (const side of [-1, 1]) {
      // Deep jambs, stepped feet and capitals make the closure feel built into stone.
      add(stone, side * 2.48, 2.57, .18, .58, 4.82, .62);
      add(stone, side * 2.48, .16, .25, .86, .3, .8);
      add(stone, side * 2.48, .38, .2, .7, .14, .7);
      add(stone, side * 2.48, 4.78, .24, .8, .16, .76);
      add(stone, side * 2.48, 4.96, .26, 1.0, .2, .82);
      // Three shallow grooves on each pilaster catch the existing room lighting.
      for (const dx of [-.17,0,.17]) add(paint, side * 2.48 + dx, 2.58, .497, .018, 4.1, .008);
      const center = side * 1.055;
      for (let p = 0; p < 7; p++) add(wood, center + (p - 3) * .284, 2.48, .06, .277, 4.52, .18);
      for (const edge of [-1,1]) add(trim, center + edge * .99, 2.48, .195, .13, 4.55, .14);
      for (const y of [.31, 1.56, 4.65]) add(trim, center, y, .195, 2.1, .17, .14);
      // Bronze hinge straps and their actual fasteners.
      for (const y of [.66, 3.94]) {
        add(bronze, center, y, .168, 1.96, .075, .035);
        for (const dx of [-.84,-.42,0,.42,.84]) studs.push({position:[center+dx,y,.19],scale:[.027,.017,.027],rotation:[Math.PI/2,0,0]});
      }
      // Small rosette plaques: a center boss and eight restrained radial petals.
      for(let p=0;p<8;p++) {
        const angle=p*Math.PI/4;
        bronze.push({position:[side*.42+Math.sin(angle)*.11,2.38+Math.cos(angle)*.11,.2],scale:[.052,.1,.025],rotation:[0,0,-angle]});
      }
      studs.push({position:[side*.42,2.38,.1735],scale:[.175,.05,.175],rotation:[Math.PI/2,0,0]});
      studs.push({position:[side*.42,2.38,.229],scale:[.068,.035,.068],rotation:[Math.PI/2,0,0]});
    }
    add(stone, 0, .06, .12, 5.7, .12, .9);
    add(stone, 0, 4.94, .18, 5.9, .25, .65);
    add(stone, 0, 5.33, .24, 6.1, .14, .84);
    add(stone, 0, design.portalCorniceTop - .04, .2, 5.92, .08, .72);
    add(stone, 0, 6.98, .09, 4.35, .12, .42);
    // Painted meander is almost flush with the blue frieze: no heavy grid shadows.
    for(let i=0;i<14;i++) {
      const x=-2.66+i*.4;
      add(bronze,x,5.23,.525,.29,.022,.008);
      add(bronze,x-.134,5.14,.525,.022,.2,.008);
      add(bronze,x+.134,5.18,.525,.022,.11,.008);
      add(bronze,x+.045,5.128,.525,.2,.022,.008);
    }
    return {stone,wood,trim,bronze,studs,paint};
  }, []);
  return <group name="Alexandrian limestone and cedar doorway" position={[design.centerX,0,10.85]} rotation-y={Math.PI} raycast={() => null}>
    <InstancedBoxes transforms={[{position:[0,2.5,-.065],scale:[4.48,4.98,.14]}]} color="#211a13" castShadow={false} />
    <InstancedBoxes transforms={layout.stone} color="#d7c9a7" map={maps.stone} normalMap={maps.stoneNormal} normalScale={.1} roughness={.78} castShadow={false} />
    <InstancedBoxes transforms={layout.wood} color="#c89a70" map={maps.wood} normalMap={maps.woodNormal} normalScale={.14} roughness={.66} emissive="#633b21" emissiveIntensity={.22} castShadow={false} receiveShadow={false} />
    <InstancedBoxes transforms={layout.trim} color="#a97b53" map={maps.wood} normalMap={maps.woodNormal} normalScale={.12} roughness={.64} emissive="#462b1b" emissiveIntensity={.16} castShadow={false} receiveShadow={false} />
    <InstancedBoxes transforms={layout.bronze} color="#ae874d" roughness={.55} metalness={.55} castShadow={false} />
    <InstancedCylinders transforms={layout.studs} color="#b79258" roughness={.46} metalness={.6} castShadow={false} />
    <InstancedBoxes transforms={layout.paint} color="#b4a586" roughness={.9} castShadow={false} />
    <InstancedBoxes transforms={[{position:[0,5.17,.49],scale:[5.62,.29,.06]}]} color={design.frameColor} roughness={.84} castShadow={false} />
    {[-1,1].map(side => <mesh key={side} position={[side*.42,2.2,.27]}>
      <torusGeometry args={[.158,.028,8,32]} />
      <meshStandardMaterial color="#ae874d" metalness={.6} roughness={.46} />
    </mesh>)}
  </group>;
}
