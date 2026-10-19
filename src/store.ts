import type { AnatomyLayer } from "./molstar/anatomy";
import { create } from "zustand";
import type { ViewOptions } from "./types";
interface StudioState {
  inferenceModel: 'slipp' | 'saprot-egnn-fold2';
  setInferenceModel: (model: StudioState['inferenceModel']) => void;
  theme: "light" | "dark";
  dockingScoring: "vina" | "vinardo";
  setDockingScoring: (scoring: "vina" | "vinardo") => void;
  toggleTheme: () => void;
  selectedId: string | null;
  presentation: boolean;
  tab: "overview" | "features" | "residues" | "model" | "docking" | "contacts" | "prepare" | "anatomy";
  anatomyLayer: AnatomyLayer;
  setAnatomyLayer: (layer: AnatomyLayer) => void;
  options: ViewOptions;
  select: (id: string | null) => void;
  toggle: (key: keyof ViewOptions) => void;
  setTab: (tab: StudioState["tab"]) => void;
  present: () => void;
}
export const useStudio = create<StudioState>((set) => ({
  inferenceModel: 'slipp',
  setInferenceModel: (inferenceModel) => set({inferenceModel}),
  dockingScoring: "vina",
  setDockingScoring: (dockingScoring) => set({dockingScoring}),
  anatomyLayer: "shape",
  setAnatomyLayer: (anatomyLayer) => set(s=>({anatomyLayer,...(anatomyLayer === "shape" ? {options:{...s.options,geometry:true}} : {})})),
  theme: "light",
  toggleTheme: () =>
    set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
  selectedId: null,
  presentation: false,
  tab: "overview",
  options: {
    cartoon: true,
    surface: false,
    geometry: true,
    allPockets: false,
    residues: true,
    ligands: true,
  },
  select: (selectedId) => set({ selectedId }),
  toggle: (key) =>
    set((s) => ({
      options: {
        ...s.options,
        [key]: !s.options[key],
        ...(key === "allPockets" && !s.options.allPockets
          ? { geometry: true }
          : {}),
        ...(key === "geometry" && s.options.geometry
          ? { allPockets: false }
          : {}),
      },
    })),
  setTab: (tab) => set({ tab }),
  present: () => set((s) => ({ presentation: !s.presentation })),
}));
