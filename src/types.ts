export const LIPID_CLASSES = ['FattyAcyls','Glycerolipids','Glycerophospholipids','Sphingolipids','SterolLipids','PrenolLipids','Saccharolipids','Polyketides'] as const;
export const LIPID_TAXONOMY = 'biodolphin_unique_values_to_canonical_v1';
export interface Residue {
  chain: string;
  seq: number;
  name: string;
  insertionCode: string;
}
export interface Pocket {
  id: string;
  rank: number;
  center: [number, number, number];
  residues: Residue[];
  fpocket: Record<string, number>;
  prediction: {
    label: string;
    probability: number;
    probabilities: Record<string, number>;
    lipidClasses?: { taxonomyVersion: string; scores: Record<string, number> };
  } | null;
  features: { name: string; value: number; unit: string | null }[];
  geometry: {
    alphaSpheres: { center: [number, number, number]; radius: number }[];
  };
}
export interface StudioProject {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  provenance: string;
  structure: {
    id: string;
    path: string;
    format: "pdb" | "mmcif";
    source: string;
  };
  model: {
    name: string;
    version: string | null;
    classes: string[];
    calibration: string;
  };
  pockets: Pocket[];
}
export interface LoadedProject {
  project: StudioProject;
  structureData: string;
  warnings: string[];
}
export interface ViewOptions {
  cartoon: boolean;
  surface: boolean;
  geometry: boolean;
  allPockets: boolean;
  residues: boolean;
  ligands: boolean;
}

export interface DockingResult {
  scoring: "vina" | "vinardo";
  preparation: PreparationReport;
  smiles: string;
  pocketId: string;
  engine: string;
  seed: number;
  exhaustiveness: number;
  cpu: number;
  center: number[];
  size: number[];
  receptorCacheHit: boolean;
  preparationSeconds: number;
  searchSeconds: number;
  totalSeconds: number;
  wallSeconds: number;
  warnings: string[];
  poses: {
    rank: number;
    score: number;
    deltaScore: number;
    components: { inter: number; intra: number; unbound: number };
    rmsdLower: number;
    rmsdUpper: number;
    sdf: string;
  }[];
}

export interface Contact {
  id: string;
  kind: string;
  residue: Residue;
  receptorAtom: string;
  ligandAtom: string;
  distance: number;
  overlap?: number;
  start: [number, number, number];
  end: [number, number, number];
}
export interface LigandTarget extends Residue { id: string; atoms: number }
export interface PreparationSettings {
  excludedChains: string[];
  keepResidues: string[];
  templates: Record<string, string>;
}
export interface PreparationResidue extends Residue {
  id: string; protein: boolean; supported: boolean; atoms: number; alternate: boolean;
}
export interface PreparationReport {
  structureData: string;
  removed: PreparationResidue[];
  retained: PreparationResidue[];
  assignments: Record<string, string>;
  atomCount: number;
  alternateResidues: number;
  cacheHit: boolean;
  settings: PreparationSettings;
}

export interface PickedAtom {
  label: string; element: string; charge: number; occupancy: number; position: [number,number,number];
}
