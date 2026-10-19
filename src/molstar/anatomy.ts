import 'molstar/lib/mol-script/runtime/query/table';
import { Structure, StructureElement, StructureProperties as P, Unit } from 'molstar/lib/mol-model/structure';
import { MolScriptBuilder as MS } from 'molstar/lib/mol-script/language/builder';
import { Vec3 } from 'molstar/lib/mol-math/linear-algebra';
import { FeaturesBuilder } from 'molstar/lib/mol-model-props/computed/interactions/features';
import { HydrophobicAtomProvider } from 'molstar/lib/mol-model-props/computed/interactions/hydrophobic';
import { HydrogenDonorProvider, HydrogenAcceptorProvider } from 'molstar/lib/mol-model-props/computed/interactions/hydrogen-bonds';
import { ValenceModelProvider } from 'molstar/lib/mol-model-props/computed/valence-model';
import type { CustomProperty } from 'molstar/lib/mol-model-props/common/custom-property';
import { residueAt, residueKey } from './contacts';
import type { Pocket, Residue } from '../types';

export type AnatomyLayer = 'shape'|'hydrophobic'|'polar'|'openings'|'chains';
export interface AnatomyAtom { residue: Residue; name: string; position: [number,number,number]; radius: number; roles: string[] }
export interface PocketAnatomy {
  atoms: AnatomyAtom[];
  neighbors: AnatomyAtom[];
  chains: { id:string; residues:Residue[] }[];
  openings: [number,number,number][];
  testedRays: number;
  escapeRays: number;
  dimensions: number[];
}
type Sphere = { center: readonly number[]; radius: number };
const directions=Array.from({length:96},(_,i)=>{
  const z=1-2*(i+.5)/96,r=Math.sqrt(1-z*z),a=i*Math.PI*(3-Math.sqrt(5));
  return [r*Math.cos(a),r*Math.sin(a),z];
});

/** A clear probe-center ray is a sufficient, not necessary, solvent-access route. */
export function rayEscapes(origin:readonly number[],direction:readonly number[],obstacles:Sphere[],probe=1.4) {
  return obstacles.every(atom=>{
    const dx=atom.center[0]-origin[0],dy=atom.center[1]-origin[1],dz=atom.center[2]-origin[2];
    const d2=dx*dx+dy*dy+dz*dz,r2=(atom.radius+probe)**2;
    if(d2<r2)return false;
    const t=dx*direction[0]+dy*direction[1]+dz*direction[2];
    return t<=0||d2-t*t>=r2;
  });
}
function pocketExit(origin:readonly number[],direction:readonly number[],spheres:Sphere[]) {
  const intervals=spheres.flatMap(s=>{
    const delta=s.center.map((v,i)=>v-origin[i]);
    const t=delta.reduce((sum,v,i)=>sum+v*direction[i],0);
    const d2=delta.reduce((sum,v)=>sum+v*v,0)-t*t;
    if(d2>s.radius*s.radius)return [];
    const chord=Math.sqrt(Math.max(0,s.radius*s.radius-d2));
    return [[t-chord,t+chord]];
  }).filter(([,end])=>end>=0).sort((a,b)=>a[0]-b[0]);
  let end=0;
  for(const [start,stop] of intervals){if(start>end+1e-6)break;end=Math.max(end,stop);}
  return origin.map((v,i)=>v+direction[i]*end) as [number,number,number];
}

export async function analyzeAnatomy(ctx:CustomProperty.Context,input:Structure,pocket:Pocket):Promise<PocketAnatomy> {
  // Remove ligands, ions and waters so occupancy does not hide the protein's cavity.
  const subset=StructureElement.Loci.toStructure(StructureElement.Loci.fromExpression(input,
    MS.struct.generator.atomGroups({'entity-test':MS.core.rel.eq([MS.struct.atomProperty.macromolecular.entityType(),'polymer'])})));
  const structure=Structure.create(subset.units);
  await ValenceModelProvider.attach(ctx,structure);
  const lining=new Set(pocket.residues.map(residueKey));
  const atoms:AnatomyAtom[]=[],neighbors:AnatomyAtom[]=[],obstacles:Sphere[]=[];
  const spheres=pocket.geometry.alphaSpheres;
  const chains=new Map<string,Map<string,Residue>>();
  for(const unit of structure.units) {
    if(!Unit.isAtomic(unit))continue;
    const roles=new Map<number,string[]>();
    for(const [provider,role] of [[HydrophobicAtomProvider,'Hydrophobic'],[HydrogenDonorProvider,'Donor'],[HydrogenAcceptorProvider,'Acceptor']] as const) {
      const builder=FeaturesBuilder.create();provider.add(structure,unit,builder);
      const features=builder.getFeatures(unit.elements.length);
      for(let i=0;i<features.members.length;i++) {
        const element=unit.elements[features.members[i]];
        const values=roles.get(element)??[];if(!values.includes(role))values.push(role);roles.set(element,values);
      }
    }
    for(let i=0;i<unit.elements.length;i++) {
      const element=unit.elements[i],location=StructureElement.Location.create(structure,unit,element);
      if(P.atom.type_symbol(location)==='H')continue;
      const residue=residueAt(structure,unit,element);
      const position=[...unit.conformation.position(element,Vec3())] as [number,number,number];
      const radius=P.atom.vdw_radius(location);
      obstacles.push({center:position,radius});
      const atom={residue,name:P.atom.label_atom_id(location),position,radius,roles:roles.get(element)??[]};
      if(lining.has(residueKey(residue)))atoms.push(atom);
      if(spheres.some(s=>position.reduce((sum,v,j)=>sum+(v-s.center[j])**2,0)<=(s.radius+5)**2)) {
        neighbors.push(atom);
        const residues=chains.get(residue.chain)??new Map();residues.set(residueKey(residue),residue);chains.set(residue.chain,residues);
      }
    }
  }
  const openings=new Map<string,[number,number,number]>();
  let testedRays=0,escapeRays=0;
  // ponytail: bounded straight-ray sampling misses curved entrances; add a tunnel solver if needed.
  const stride=Math.max(1,Math.ceil(spheres.length/128));
  for(let i=0;i<spheres.length;i+=stride) {
    if(ctx.runtime.shouldUpdate)await ctx.runtime.update({message:'Inspecting solvent access',current:i,max:spheres.length});
    for(const direction of directions) {
      testedRays++;
      if(!rayEscapes(spheres[i].center,direction,obstacles))continue;
      escapeRays++;
      const point=pocketExit(spheres[i].center,direction,spheres);
      const key=point.map(v=>Math.floor(v/2)).join(',');
      if(!openings.has(key))openings.set(key,point);
    }
  }
  return {atoms,neighbors,chains:[...chains].map(([id,residues])=>({id,residues:[...residues.values()]})),openings:[...openings.values()],testedRays,escapeRays,
    dimensions:[0,1,2].map(i=>spheres.length?Math.max(...spheres.map(s=>s.center[i]+s.radius))-Math.min(...spheres.map(s=>s.center[i]-s.radius)):0)};
}
