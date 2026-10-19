import { resizeWithFrame } from "./resize";
import { PluginContext } from "molstar/lib/mol-plugin/context";
import { DefaultPluginSpec } from "molstar/lib/mol-plugin/spec";
import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";
import { SsaoParams } from "molstar/lib/mol-canvas3d/passes/ssao";
import { Color } from "molstar/lib/mol-util/color";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import { Sphere3D } from "molstar/lib/mol-math/geometry";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { Structure, StructureElement, StructureProperties as P, Unit, Bond } from "molstar/lib/mol-model/structure";
import { setSubtreeVisibility } from "molstar/lib/mol-plugin/behavior/static/state";
import { StateObjectSelector } from "molstar/lib/mol-state";
import { PluginStateObject as SO } from "molstar/lib/mol-plugin-state/objects";
import { Mesh } from "molstar/lib/mol-geo/geometry/mesh/mesh";
import { MeshBuilder } from "molstar/lib/mol-geo/geometry/mesh/mesh-builder";
import { Task } from "molstar/lib/mol-task";
import { addFixedCountDashedCylinder } from "molstar/lib/mol-geo/geometry/mesh/builder/cylinder";
import { analyzeAnatomy, type AnatomyLayer, type PocketAnatomy } from "./anatomy";
import { analyzeContacts, ligandTargets, receptorInventory } from "./contacts";
import type { Contact, PickedAtom } from "../types";
import { addSphere } from "molstar/lib/mol-geo/geometry/mesh/builder/sphere";
import { Shape } from "molstar/lib/mol-model/shape";
import { ShapeRepresentation } from "molstar/lib/mol-repr/shape/representation";
import type { LoadedProject, Pocket, Residue, ViewOptions } from "../types";

type AnatomyMarkers = {position:[number,number,number];radius:number;color:number;label:string}[];
const pocketColor = Color(0x5997d5);
function residueExpression(residues: Residue[]) {
  return MS.struct.generator.atomGroups({
    "residue-test": MS.core.logic.or(
      residues.map((r) =>
        MS.core.logic.and([
          MS.core.rel.eq([
            MS.struct.atomProperty.macromolecular.auth_asym_id(),
            r.chain,
          ]),
          MS.core.rel.eq([
            MS.struct.atomProperty.macromolecular.auth_seq_id(),
            r.seq,
          ]),
          MS.core.rel.eq([
            MS.struct.atomProperty.macromolecular.pdbx_PDB_ins_code(),
            r.insertionCode,
          ]),
        ]),
      ),
    ),
  });
}

export class MolstarController {
  private plugin = new PluginContext(DefaultPluginSpec());
  private structure?: StateObjectSelector<SO.Molecule.Structure>;
  private cartoon?: string;
  private dockedRoot?: string;
  private dockedStructure?: Structure;
  private preparedRoot?: string;
  private previewRoot?: string;
  private preparedPdb?: string;
  private previewVisibility = new Map<string, boolean>();
  private previewShapeVisibility = new Map<string, boolean>();
  private preparedStructure?: Structure;
  private anatomyCache = new Map<string, PocketAnatomy>();
  private anatomyShape?: ReturnType<typeof ShapeRepresentation<AnatomyMarkers, Mesh, typeof Mesh.Params>>;
  private anatomyRevision = 0;
  private contactCache = new Map<string, Contact[]>();
  private contactShape?: ReturnType<typeof ShapeRepresentation<Contact[], Mesh, typeof Mesh.Params>>;
  private contactRevision = 0;
  private poseRevision = 0;
  private surface?: string;
  private ligand?: string;
  private active?: string;
  private pockets: Pocket[] = [];
  private allPockets = false;
  private pocketComponents = new Map<string, string>();
  private shapes = new Map<
    string,
    ReturnType<typeof ShapeRepresentation<Pocket, Mesh, typeof Mesh.Params>>
  >();
  private queue: Promise<void> = Promise.resolve();
  private revision = 0;
  private disposed = false;
  private theme: "light" | "dark" = "light";
  private duration = matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : 550;
  private resize?: ResizeObserver;
  private restoreResize?: () => void;

  async init(host: HTMLDivElement, theme: "light" | "dark") {
    this.theme = theme;
    await this.plugin.init();
    if (!(await this.plugin.mountAsync(host)))
      throw new Error(
        "WebGL could not start. Check hardware graphics support.",
      );
    this.plugin.canvas3d?.setProps({
      renderer: {
        backgroundColor: Color(theme === "light" ? 0xe9edf0 : 0x111618),
      },
      camera: { helper: { axes: { name: "off", params: {} } } },
      cameraFog: { name: "off", params: {} },
      postprocessing: {
        occlusion: {
          name: "on",
          params: {
            ...PD.getDefaultValues(SsaoParams),
            samples: 32,
            radius: 4,
            bias: 0.8,
          },
        },
        outline: {
          name: "on",
          params: {
            scale: 1,
            threshold: 0.35,
            color: Color(0x34474d),
            includeTransparent: false,
          },
        },
        shadow: {
          name: "on",
          params: { steps: 1, maxDistance: 3, tolerance: 1 },
        },
      },
      marking: {
        highlightEdgeColor: Color(0x89bfff),
        selectEdgeColor: pocketColor,
      },
    });
    this.restoreResize = resizeWithFrame(this.plugin);
    this.resize = new ResizeObserver(() => this.plugin.handleResize());
    this.resize.observe(host);
  }

  setTheme(theme: "light" | "dark") {
    this.theme = theme;
    this.plugin.canvas3d?.setProps({
      renderer: {
        backgroundColor: Color(theme === "light" ? 0xe9edf0 : 0x111618),
      },
    });
  }

  async load(loaded: LoadedProject, appearance: "standard" | "home" = "standard") {
    await this.queue;
    this.revision++;
    this.anatomyCache.clear();
    this.clearAnatomyShape();
    this.contactCache.clear();
    this.dockedStructure = undefined;
    this.preparedStructure = undefined;
    this.preparedPdb = undefined;
    this.previewRoot = undefined;
    this.previewVisibility.clear();this.previewShapeVisibility.clear();
    this.dockedRoot = this.preparedRoot = undefined;
    this.clearContactShape();
    for (const shape of this.shapes.values()) {
      this.plugin.canvas3d?.remove(shape);
      shape.destroy();
    }
    this.shapes.clear();
    this.pocketComponents.clear();
    this.active = undefined;
    this.pockets = loaded.project.pockets;
    this.allPockets = false;
    await this.plugin.clear();
    const b = this.plugin.builders.structure;
    const data = await this.plugin.builders.data.rawData({
      data: loaded.structureData,
      label: loaded.project.structure.id,
    });
    const trajectory = await b.parseTrajectory(
      data,
      loaded.project.structure.format,
    );
    const model = await b.createModel(trajectory);
    // Match the coordinate model used by fpocket and docking; do not auto-expand biological assemblies.
    this.structure = await b.createStructure(model, { name: "model", params: {} });
    const polymer = await b.tryCreateComponentStatic(this.structure, "polymer");
    if (!polymer) throw new Error("No polymer atoms found in this structure.");
    const cartoon = await b.representation.addRepresentation(polymer, {
      type: "cartoon",
      ...(appearance === "home" ? {
        color: "secondary-structure" as const,
        colorParams: { saturation: 0, lightness: 0, colors: { name: "custom" as const, params: {
          alphaHelix: Color(0x45a994), threeTenHelix: Color(0x45a994), piHelix: Color(0x45a994),
          betaStrand: Color(0x508dcb), betaTurn: Color(0xb0c7d6), coil: Color(0xb0c7d6), bend: Color(0xb0c7d6), turn: Color(0xb0c7d6),
          dna: Color(0xb0c7d6), rna: Color(0xb0c7d6), carbohydrate: Color(0xb0c7d6),
        } } },
      } : { color: "uniform" as const, colorParams: { value: Color(0x829296) } }),
      typeParams: { quality: "high" },
    });
    this.cartoon = cartoon.ref;
    this.surface = undefined;
    const ligand = await b.tryCreateComponentStatic(this.structure, "ligand");
    this.ligand = ligand?.ref;
    if (ligand)
      await b.representation.addRepresentation(ligand, {
        type: "ball-and-stick",
        color: "element-symbol",
        colorParams: {
          carbonColor: { name: "uniform", params: { value: Color(0x6db79f) } },
        },
        typeParams: { sizeFactor: 0.24 },
      });
    if (appearance === "home" && this.structure.obj) {
      this.plugin.canvas3d?.setProps({postprocessing:{outline:{name:"off",params:{}}}});
      this.plugin.managers.camera.focusSphere(this.structure.obj.data.boundary.sphere,{durationMs:0,extraRadius:-2});
    } else this.reset();
  }

  synchronize(
    pocket: Pocket | undefined,
    options: ViewOptions,
    docking = false,
  ): Promise<void> {
    const revision = ++this.revision;
    const work = this.queue.then(async () => {
      if (this.disposed || revision !== this.revision || !this.structure)
        return;
      if (options.surface && !this.surface) {
        const polymer =
          await this.plugin.builders.structure.tryCreateComponentStatic(
            this.structure,
            "polymer",
          );
        if (polymer)
          this.surface = (
            await this.plugin.builders.structure.representation.addRepresentation(
              polymer,
              {
                type: "molecular-surface",
                color: "uniform",
                colorParams: { value: Color(0x829296) },
                typeParams: { alpha: 0.18, quality: "medium" },
              },
            )
          ).ref;
      }
      if (pocket && !this.pocketComponents.has(pocket.id)) {
        const component =
          await this.plugin.builders.structure.tryCreateComponentFromExpression(
            this.structure,
            residueExpression(pocket.residues),
            pocket.id,
          );
        if (!component && pocket.residues.length)
          throw new Error(
            `${pocket.id}: residue identifiers do not map to the displayed structure.`,
          );
        if (component) {
          await this.plugin.builders.structure.representation.addRepresentation(
            component,
            {
              type: "ball-and-stick",
              color: "uniform",
              colorParams: { value: pocketColor },
              typeParams: { sizeFactor: 0.2 },
            },
          );
          this.pocketComponents.set(pocket.id, component.ref);
        }
      }
      const overlays = options.allPockets
        ? this.pockets
        : pocket
          ? [pocket]
          : [];
      for (const overlay of overlays) {
        if (revision !== this.revision || this.disposed) return;
        if (
          overlay.geometry.alphaSpheres.length &&
          !this.shapes.has(overlay.id)
        ) {
          const shape = ShapeRepresentation<Pocket, Mesh, typeof Mesh.Params>(
            (_, p) => {
              const mesh = MeshBuilder.createState();
              p.geometry.alphaSpheres.forEach((s, i) => {
                mesh.currentGroup = i;
                addSphere(mesh, Vec3.create(...s.center), s.radius, 2);
              });
              return Shape.create(
                "fpocket alpha spheres",
                p,
                MeshBuilder.getMesh(mesh),
                () => pocketColor,
                () => 1,
                () => `${p.id} · fpocket alpha sphere`,
              );
            },
            Mesh.Utils,
          );
          await this.plugin.runTask(
            shape.createOrUpdate(
              {
                alpha: 0.3,
                xrayShaded: false,
                material: { metalness: 0, roughness: 0.55, bumpiness: 0 },
                transparentBackfaces: "off",
                doubleSided: false,
                quality: "high",
              },
              overlay,
            ),
          );
          shape.setState({ visible: false });
          this.plugin.canvas3d?.add(shape);
          this.shapes.set(overlay.id, shape);
        }
      }
      if (revision !== this.revision) return;
      this.visible(this.cartoon, options.cartoon);
      this.visible(this.surface, options.surface);
      this.visible(this.ligand, options.ligands);
      for (const [id, ref] of this.pocketComponents)
        this.visible(ref, id === pocket?.id && options.residues);
      for (const [id, shape] of this.shapes) {
        const visible =
          options.geometry && (options.allPockets || id === pocket?.id);
        const baseAlpha =
          this.theme === "light"
            ? id === pocket?.id
              ? 0.32
              : 0.18
            : id === pocket?.id
              ? 0.35
              : 0.2;
        const alpha = baseAlpha * (docking ? 0.2 : 1);
        if (
          visible &&
          (shape.props.alpha !== alpha || shape.props.xrayShaded !== docking)
        )
          await this.plugin.runTask(
            shape.createOrUpdate({ alpha, xrayShaded: docking }),
          );
        shape.setState({ visible });
        this.plugin.canvas3d?.update(shape);
      }
      if (pocket?.id !== this.active) {
        this.active = pocket?.id;
        if (pocket) this.focusPocket(pocket);
        else this.reset();
      }
      if (options.allPockets && !this.allPockets) this.reset();
      this.allPockets = options.allPockets;
    });
    this.queue = work.catch(() => {});
    return work;
  }
  private visible(ref: string | undefined, visible: boolean) {
    if (ref) setSubtreeVisibility(this.plugin.state.data, ref, !visible);
  }
  focusPocket(pocket: Pocket, tight = false) {
    const center = Vec3.create(...pocket.center);
    const radius = Math.max(
      6,
      ...pocket.geometry.alphaSpheres.map(
        (s) => Vec3.distance(center, Vec3.create(...s.center)) + s.radius,
      ),
    );
    this.plugin.managers.camera.focusSphere(Sphere3D.create(center, radius), {
      durationMs: this.duration,
      extraRadius: tight ? 3 : 17,
    });
  }
  focusResidue(residue: Residue) {
    if (!this.structure?.obj) return;
    this.plugin.managers.camera.focusLoci(
      StructureElement.Loci.fromExpression(
        this.structure.obj.data,
        residueExpression([residue]),
      ),
      { durationMs: this.duration, minRadius: 6, extraRadius: 4 },
    );
  }
  hoverResidue(residue?: Residue) {
    this.plugin.managers.interactivity.lociHighlights.clearHighlights();
    if (residue && this.structure?.obj)
      this.plugin.managers.interactivity.lociHighlights.highlightOnly({
        loci: StructureElement.Loci.fromExpression(
          this.structure.obj.data,
          residueExpression([residue]),
        ),
      });
  }
  reset() {
    if (this.structure?.obj)
      this.plugin.managers.camera.focusSphere(
        this.structure.obj.data.boundary.sphere,
        { durationMs: this.duration, extraRadius: 4 },
      );
  }
  showDockedPose(sdf: string | null): Promise<void> {
    const revision = ++this.poseRevision;
    const work = this.queue.then(async () => {
      if (this.disposed || revision !== this.poseRevision) return;
      this.contactCache.clear();
      this.dockedStructure = undefined;
      this.clearContactShape();
      if (this.dockedRoot) {
        await this.plugin.build().delete(this.dockedRoot).commit();
        this.dockedRoot = undefined;
      }
      if (!sdf) return;
      const data = await this.plugin.builders.data.rawData({
        data: sdf,
        label: "Docked ligand · Vina",
      });
      this.dockedRoot = data.ref;
      const b = this.plugin.builders.structure;
      const trajectory = await b.parseTrajectory(data, "sdf");
      const model = await b.createModel(trajectory);
      const structure = await b.createStructure(model, { name: "model", params: {} });
      this.dockedStructure = structure.obj?.data;
      await b.representation.addRepresentation(structure, {
        type: "ball-and-stick",
        color: "element-symbol",
        colorParams: {
          carbonColor: { name: "uniform", params: { value: Color(0x986bc3) } },
        },
        typeParams: { sizeFactor: 0.3 },
      });
    });
    this.queue = work.catch(() => {});
    return work;
  }
  async inspectAnatomy(pocket: Pocket): Promise<PocketAnatomy> {
    await this.queue;
    if(!this.structure?.obj||this.disposed)throw new Error("Structure is not ready.");
    const cached=this.anatomyCache.get(pocket.id);if(cached)return cached;
    const input=this.structure.obj.data;
    const result=await this.plugin.runTask(Task.create("Pocket anatomy",runtime=>analyzeAnatomy({runtime,assetManager:this.plugin.managers.asset},input,pocket)));
    if(!this.disposed&&this.structure?.obj?.data===input)this.anatomyCache.set(pocket.id,result);
    return result;
  }
  private clearAnatomyShape() {
    this.anatomyRevision++;
    if(this.anatomyShape){this.plugin.canvas3d?.remove(this.anatomyShape);this.anatomyShape.destroy();this.anatomyShape=undefined;}
  }
  async showAnatomy(data: PocketAnatomy|null, layer: AnatomyLayer, chain?:string, residue?:Residue) {
    this.clearAnatomyShape();
    if(!data||layer==='shape'||this.disposed)return;
    const revision=this.anatomyRevision;
    const chainColors=[0x6d9cb7,0xa981b1,0x579e8a,0xc5836c,0x838dc2];
    const markers:AnatomyMarkers=layer==='openings'?data.openings.map(position=>({position,radius:.8,color:0x458f8b,label:"Sampled solvent-access point · 1.4 Å probe"})):
      (layer==='chains'?data.neighbors:data.atoms).filter(a=>layer==='hydrophobic'?a.roles.includes('Hydrophobic'):layer==='polar'?a.roles.some(r=>r==='Donor'||r==='Acceptor'):chain===undefined||a.residue.chain===chain)
      .filter(a=>!residue||(a.residue.chain===residue.chain&&a.residue.seq===residue.seq&&a.residue.insertionCode===residue.insertionCode))
      .map(a=>({position:a.position,radius:a.radius*.37,color:layer==='hydrophobic'?0xb27c53:layer==='polar'?(a.roles.includes('Donor')&&a.roles.includes('Acceptor')?0x9a77b9:a.roles.includes('Donor')?0x518fb5:0xc16d7e):chainColors[data.chains.findIndex(c=>c.id===a.residue.chain)%chainColors.length],
        label:`${a.residue.name} ${a.residue.chain}:${a.residue.seq}${a.residue.insertionCode} · ${a.name} · ${a.roles.join(' / ')||'Polymer atom'}`}));
    if(!markers.length)return;
    const shape=ShapeRepresentation<AnatomyMarkers,Mesh,typeof Mesh.Params>((_,points)=>{
      const mesh=MeshBuilder.createState();points.forEach((point,i)=>{mesh.currentGroup=i;addSphere(mesh,Vec3.create(...point.position),point.radius,1);});
      return Shape.create("Pocket anatomy",points,MeshBuilder.getMesh(mesh),i=>Color(points[i].color),()=>1,i=>points[i].label);
    },Mesh.Utils);
    await this.plugin.runTask(shape.createOrUpdate({alpha:1,material:{metalness:0,roughness:.7,bumpiness:0}},markers));
    if(this.disposed||revision!==this.anatomyRevision){shape.destroy();return;}
    this.anatomyShape=shape;this.plugin.canvas3d?.add(shape);
  }
  onAtomPick(callback: (atom: PickedAtom) => void) {
    const subscription=this.plugin.behaviors.interaction.click.subscribe(({current})=>{
      const loci=Bond.isLoci(current.loci) ? Bond.toFirstStructureElementLoci(current.loci) : current.loci;
      if(!StructureElement.Loci.is(loci) || StructureElement.Loci.size(loci)!==1) return;
      const location=StructureElement.Loci.getFirstLocation(loci);
      if(!location||!Unit.isAtomic(location.unit))return;
      const position=location.unit.conformation.position(location.element,Vec3());
      callback({label:`${P.atom.label_comp_id(location)} ${P.chain.auth_asym_id(location)}:${P.residue.auth_seq_id(location)}${P.residue.pdbx_PDB_ins_code(location)} · ${P.atom.label_atom_id(location)}`,
        element:P.atom.type_symbol(location),charge:P.atom.pdbx_formal_charge(location),occupancy:P.atom.occupancy(location),position:[...position] as [number,number,number]});
    });
    return ()=>subscription.unsubscribe();
  }
  getReceptorInventory() { return this.structure?.obj ? receptorInventory(this.structure.obj.data) : []; }
  getLigands() { return this.structure?.obj ? ligandTargets(this.structure.obj.data) : []; }
  async inspectContacts(target: string): Promise<Contact[]> {
    await this.queue;
    if (!this.structure?.obj || this.disposed) return [];
    if (this.contactCache.has(target)) return this.contactCache.get(target)!;
    const base = target === "docked" && this.preparedStructure ? this.preparedStructure : this.structure.obj.data;
    let structure = base;
    if (target === "docked") {
      if (!this.dockedStructure) return [];
      const builder = Structure.Builder();
      for (const unit of [...base.units, ...this.dockedStructure.units])
        builder.addUnit(unit.kind, unit.model, unit.conformation.operator, unit.elements, unit.traits);
      structure = builder.getStructure();
    }
    const result = await this.plugin.runTask(Task.create("Analyze ligand contacts", runtime =>
      analyzeContacts({ runtime, assetManager: this.plugin.managers.asset }, structure, target, this.dockedStructure?.models[0]?.id)));
    if (!this.disposed) this.contactCache.set(target, result);
    return result;
  }
  private clearContactShape() {
    this.contactRevision++;
    if (this.contactShape) {
      this.plugin.canvas3d?.remove(this.contactShape);
      this.contactShape.destroy(); this.contactShape = undefined;
    }
  }
  async showContacts(contacts: Contact[], selected?: string) {
    this.clearContactShape();
    if (!contacts.length || this.disposed) return;
    const revision = this.contactRevision;
    const shape = ShapeRepresentation<Contact[], Mesh, typeof Mesh.Params>((_, data) => {
      const mesh = MeshBuilder.createState();
      data.forEach((c,i) => {
        mesh.currentGroup=i;
        addFixedCountDashedCylinder(mesh,Vec3.create(...c.start),Vec3.create(...c.end),1,9,false,
          {radiusTop:c.id === selected ? 0.11 : 0.055,radiusBottom:c.id === selected ? 0.11 : 0.055,radialSegments:8});
      });
      return Shape.create("Ligand contacts",data,MeshBuilder.getMesh(mesh),
        i=>Color(data[i].kind === 'Steric overlap' ? 0xd45665 : data[i].kind === 'Hydrophobic Contact' ? 0x889098 : 0x348d9f),
        ()=>1,i=>`${data[i].kind} · ${data[i].residue.name} ${data[i].residue.chain}:${data[i].residue.seq} · ${data[i].distance.toFixed(2)} Å`);
    },Mesh.Utils);
    await this.plugin.runTask(shape.createOrUpdate({alpha:0.95},contacts));
    if (this.disposed || revision !== this.contactRevision) { shape.destroy(); return; }
    this.contactShape=shape; this.plugin.canvas3d?.add(shape);
  }
  focusContact(contact: Contact) {
    const center=Vec3.scale(Vec3(),Vec3.add(Vec3(),Vec3.create(...contact.start),Vec3.create(...contact.end)),0.5);
    this.plugin.managers.camera.focusSphere(Sphere3D.create(center,Math.max(3,contact.distance)),{durationMs:this.duration,extraRadius:4});
    this.hoverResidue(contact.residue);
  }
  async setPreparedReceptor(pdb: string | null) {
    if (pdb === this.preparedPdb) return;
    this.preparedPdb = pdb ?? undefined;
    const work = this.queue.then(async () => {
      if (this.disposed) return;
      this.contactCache.clear(); this.clearContactShape();
      if (this.preparedRoot) await this.plugin.build().delete(this.preparedRoot).commit();
      this.preparedRoot=undefined; this.preparedStructure=undefined;
      if (pdb) {
        const b=this.plugin.builders.structure;
        const data=await this.plugin.builders.data.rawData({data:pdb,label:"Prepared receptor"});
        this.preparedRoot=data.ref;
        const model=await b.createModel(await b.parseTrajectory(data,"pdb"));
        const structure=await b.createStructure(model, { name: "model", params: {} });
        this.preparedStructure=structure.obj?.data;
        await b.representation.addRepresentation(structure,{type:"ball-and-stick",color:"element-symbol",
          typeParams:{sizeFactor:0.15},colorParams:{carbonColor:{name:"uniform",params:{value:Color(0x829296)}}}});
        this.visible(this.preparedRoot,false);
      }

    });
    this.queue=work.catch(()=>{}); return work;
  }
  async showPreparation(pdb: string | null) {
    const work=this.queue.then(async()=>{
      if(this.disposed) return;
      if(this.previewRoot) {
        await this.plugin.build().delete(this.previewRoot).commit(); this.previewRoot=undefined;
        for(const [ref,isHidden] of this.previewVisibility)
          if(this.plugin.state.data.cells.has(ref)) this.plugin.state.data.updateCellState(ref,{isHidden});
        for(const [id,visible] of this.previewShapeVisibility) {
          const shape=this.shapes.get(id); if(shape){shape.setState({visible});this.plugin.canvas3d?.update(shape);}
        }
        this.previewVisibility.clear();this.previewShapeVisibility.clear();
      }
      if(!pdb) return;
      for(const [ref,cell] of this.plugin.state.data.cells) this.previewVisibility.set(ref,!!cell.state.isHidden);
      for(const [id,shape] of this.shapes){this.previewShapeVisibility.set(id,shape.state.visible);shape.setState({visible:false});this.plugin.canvas3d?.update(shape);}
      this.visible(this.structure?.ref,false);this.visible(this.dockedRoot,false);
      const b=this.plugin.builders.structure;
      const data=await this.plugin.builders.data.rawData({data:pdb,label:"Prepared receptor preview"});this.previewRoot=data.ref;
      const model=await b.createModel(await b.parseTrajectory(data,"pdb"));
      const structure=await b.createStructure(model, { name: "model", params: {} });
      await b.representation.addRepresentation(structure,{type:"ball-and-stick",color:"element-symbol",typeParams:{sizeFactor:0.16}});
    });
    this.queue=work.catch(()=>{});return work;
  }
  setClipping(value: number) {
    const canvas=this.plugin.canvas3d;
    if (canvas) canvas.setProps({cameraClipping:{radius:100-value,far:true,minNear:0.1}});
  }
  async thumbnail() {
    const uri=await this.screenshot();
    const img=new Image();img.src=uri;await img.decode();
    const canvas=document.createElement("canvas");canvas.width=112;canvas.height=84;
    const context=canvas.getContext("2d")!;
    context.fillStyle=this.theme==="light"?"#e9edf0":"#111618";context.fillRect(0,0,112,84);
    const scale=Math.min(112/img.width,84/img.height),w=img.width*scale,h=img.height*scale;
    context.drawImage(img,(112-w)/2,(84-h)/2,w,h);
    return canvas.toDataURL("image/png");
  }
  async screenshot() {
    const helper = this.plugin.helpers.viewportScreenshot;
    if (!helper) throw new Error("Screenshot renderer is unavailable.");
    return helper.getImageDataUri();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.revision++;
    this.resize?.disconnect();
    this.restoreResize?.();
    void this.queue.finally(() => {
      this.clearContactShape();
      this.clearAnatomyShape();
      for (const s of this.shapes.values()) s.destroy();
      this.plugin.dispose();
    });
  }
}
