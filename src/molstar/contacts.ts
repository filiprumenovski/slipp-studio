import { Structure, StructureElement, StructureProperties as P, Unit } from "molstar/lib/mol-model/structure";
import { computeInteractions, InteractionsParams } from "molstar/lib/mol-model-props/computed/interactions/interactions";
import { Features } from "molstar/lib/mol-model-props/computed/interactions/features";
import { interactionTypeLabel } from "molstar/lib/mol-model-props/computed/interactions/common";
import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import type { CustomProperty } from "molstar/lib/mol-model-props/common/custom-property";
import type { Contact, LigandTarget, Residue } from "../types";

export function residueAt(structure: Structure, unit: Unit.Atomic, element: StructureElement.Location['element']): Residue {
  const l = StructureElement.Location.create(structure, unit, element);
  return { chain: P.chain.auth_asym_id(l), seq: P.residue.auth_seq_id(l), name: P.atom.label_comp_id(l), insertionCode: P.residue.pdbx_PDB_ins_code(l) };
}
export const residueKey = (r: Residue) => `${r.chain}:${r.seq}${r.insertionCode}`;
export function ligandTargets(structure: Structure): LigandTarget[] {
  const residues = new Map<string, LigandTarget>();
  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit)) continue;
    for (let elementIndex=0; elementIndex<unit.elements.length; elementIndex++) {
      const element=unit.elements[elementIndex];
      const l = StructureElement.Location.create(structure, unit, element);
      if (P.entity.type(l) === 'polymer' || P.entity.type(l) === 'water') continue;
      const r = residueAt(structure, unit, element), id = residueKey(r);
      const item = residues.get(id) ?? { ...r, id, atoms: 0 };
      item.atoms++; residues.set(id, item);
    }
  }
  return [...residues.values()].filter(r => r.atoms > 1);
}

export async function analyzeContacts(ctx: CustomProperty.Context, structure: Structure, target: string, dockedModelId?: string): Promise<Contact[]> {
  const isTarget = (unit: Unit.Atomic, element: StructureElement.Location['element']) =>
    target === 'docked' ? unit.model.id === dockedModelId : unit.model.id !== dockedModelId && residueKey(residueAt(structure, unit, element)) === target;
  const params = PD.getDefaultValues(InteractionsParams);
  Object.assign(params.providers, {
    hydrophobic: { name: 'on', params: { distanceMax: 4 } },
    ionic: { name: 'on', params: { distanceMax: 5 } },
  });
  const interactions = await computeInteractions(ctx, structure, params, target === 'docked' ? {
    // Docked ligands come from a separate SDF model; Mol* otherwise skips cross-model pairs.
    unitPairTest: (a,b) => (a.model.id === dockedModelId) !== (b.model.id === dockedModelId),
    skipIntraContacts: true,
  } : undefined);
  const contacts: Contact[] = [], seen = new Set<string>();
  function add(unitA: Unit, indexA: number, unitB: Unit, indexB: number, type: number, flag: number) {
    if (flag || !Unit.isAtomic(unitA) || !Unit.isAtomic(unitB)) return;
    const fa = interactions.unitsFeatures.get(unitA.id)!, fb = interactions.unitsFeatures.get(unitB.id)!;
    const ea = unitA.elements[fa.members[fa.offsets[indexA]]], eb = unitB.elements[fb.members[fb.offsets[indexB]]];
    const aTarget = isTarget(unitA, ea), bTarget = isTarget(unitB, eb);
    if (aTarget === bTarget) return;
    const a = Features.setPosition(Vec3(), unitA, indexA as Features.FeatureIndex, fa);
    const b = Features.setPosition(Vec3(), unitB, indexB as Features.FeatureIndex, fb);
    const receptorUnit = aTarget ? unitB : unitA, receptorElement = aTarget ? eb : ea;
    const ligandUnit = aTarget ? unitA : unitB;
    const r = residueAt(structure, receptorUnit, receptorElement);
    const featureAtoms = (unit: Unit.Atomic, f: Features, index: number) => Array.from({length:f.offsets[index+1]-f.offsets[index]},(_,i)=>unit.elements[f.members[f.offsets[index]+i]]);
    const membersA=featureAtoms(unitA,fa,indexA), membersB=featureAtoms(unitB,fb,indexB);
    const key = [`${unitA.id}:${membersA.join(',')}`, `${unitB.id}:${membersB.join(',')}`].sort().join('-') + ':' + type;
    if (seen.has(key)) return;
    seen.add(key);
    const names=(unit:Unit.Atomic,elements:typeof membersA)=>elements.map(e=>P.atom.label_atom_id(StructureElement.Location.create(structure,unit,e))).join('/');
    contacts.push({ id: key, kind: interactionTypeLabel(type), residue: r,
      receptorAtom: names(receptorUnit,aTarget?membersB:membersA),
      ligandAtom: names(ligandUnit,aTarget?membersA:membersB),
      distance: Vec3.distance(a, b), start: [...a] as [number,number,number], end: [...b] as [number,number,number] });
  }
  for (const edge of interactions.contacts.edges) add(structure.unitMap.get(edge.unitA)!, edge.indexA, structure.unitMap.get(edge.unitB)!, edge.indexB, edge.props.type, edge.props.flag);
  for (const unit of structure.units) {
    const c = interactions.unitsContacts.get(unit.id);
    if (c) for (let i = 0; i < c.a.length; i++) add(unit, c.a[i], unit, c.b[i], c.edgeProps.type[i], c.edgeProps.flag[i]);
  }
  // Spatial buckets keep clash detection local instead of scanning all atom pairs.
  const atoms: { unit: Unit.Atomic; element: StructureElement.Location['element']; p: Vec3; radius: number }[] = [];
  const buckets = new Map<string, typeof atoms>();
  const key = (x:number,y:number,z:number) => `${x},${y},${z}`;
  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit)) continue;
    for (let elementIndex=0; elementIndex<unit.elements.length; elementIndex++) {
      const element=unit.elements[elementIndex];
      const l = StructureElement.Location.create(structure,unit,element);
      if (P.atom.type_symbol(l) === 'H') continue;
      const atom = {unit,element,p:unit.conformation.position(element,Vec3()),radius:P.atom.vdw_radius(l)};
      if (isTarget(unit,element)) atoms.push(atom);
      else {
        // Generic vdW overlap is not a useful metal-coordination test.
        if (!['C','N','O','S','P','F','CL','BR','I'].includes(P.atom.type_symbol(l))) continue;
        const k = key(...atom.p.map(v=>Math.floor(v/4)) as [number,number,number]);
        const bucket=buckets.get(k) ?? []; bucket.push(atom); buckets.set(k,bucket);
      }
    }
  }
  for (const a of atoms) {
    const [x,y,z]=a.p.map(v=>Math.floor(v/4));
    for (let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) for(let dz=-1;dz<=1;dz++) {
      for (const b of buckets.get(key(x+dx,y+dy,z+dz)) ?? []) {
        const distance=Vec3.distance(a.p,b.p), overlap=a.radius+b.radius-distance;
        if (overlap <= 0.6) continue;
        const residue=residueAt(structure,b.unit,b.element);
        contacts.push({id:`clash:${a.unit.id}:${a.element}:${b.unit.id}:${b.element}`,kind:'Steric overlap',residue,
          receptorAtom:P.atom.label_atom_id(StructureElement.Location.create(structure,b.unit,b.element)),
          ligandAtom:P.atom.label_atom_id(StructureElement.Location.create(structure,a.unit,a.element)),
          distance,overlap,start:[...a.p] as [number,number,number],end:[...b.p] as [number,number,number]});
      }
    }
  }
  return contacts.sort((a,b)=>a.kind.localeCompare(b.kind)||a.distance-b.distance);
}

export function receptorInventory(structure: Structure) {
  const residues = new Map<string, import('../types').PreparationResidue>();
  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit)) continue;
    for(let i=0;i<unit.elements.length;i++) {
      const element=unit.elements[i], l=StructureElement.Location.create(structure,unit,element);
      const r=residueAt(structure,unit,element), id=residueKey(r);
      const protein=P.residue.chem_comp_type(l).includes('peptide');
      const row=residues.get(id) ?? {...r,id,protein,supported:protein||['HOH','WAT','MG','CA','MN','ZN','NA','K','CL'].includes(r.name),atoms:0,alternate:false};
      row.atoms++; row.alternate ||= !!P.atom.label_alt_id(l); residues.set(id,row);
    }
  }
  return [...residues.values()];
}
