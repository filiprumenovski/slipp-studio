use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Component, Path},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioProject {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    pub structure: Structure,
    pub model: Model,
    pub provenance: String,
    pub pockets: Vec<Pocket>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Structure {
    pub id: String,
    pub path: String,
    pub format: String,
    pub source: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Model {
    pub name: String,
    pub version: Option<String>,
    pub classes: Vec<String>,
    pub calibration: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pocket {
    pub id: String,
    pub rank: u32,
    pub center: [f64; 3],
    pub residues: Vec<Residue>,
    pub fpocket: BTreeMap<String, f64>,
    pub prediction: Option<Prediction>,
    pub features: Vec<Feature>,
    pub geometry: Geometry,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct Residue {
    pub chain: String,
    pub seq: i32,
    pub name: String,
    #[serde(default)]
    pub insertion_code: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prediction {
    pub label: String,
    pub probability: f64,
    pub probabilities: BTreeMap<String, f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lipid_classes: Option<LipidClasses>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LipidClasses {
    pub taxonomy_version: String,
    pub scores: BTreeMap<String, f64>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Feature {
    pub name: String,
    pub value: f64,
    pub unit: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub alpha_spheres: Vec<AlphaSphere>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AlphaSphere {
    pub center: [f64; 3],
    pub radius: f64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedProject {
    pub project: StudioProject,
    pub structure_data: String,
    pub warnings: Vec<String>,
}

fn validate(project: &StudioProject) -> Result<(), String> {
    if project.schema_version != 1 {
        return Err(format!(
            "Unsupported project schema {}. Expected version 1.",
            project.schema_version
        ));
    }
    if project.id.trim().is_empty() || project.name.trim().is_empty() {
        return Err("Project ID and name must not be empty.".into());
    }
    if !["pdb", "mmcif"].contains(&project.structure.format.as_str()) {
        return Err("Structure format must be pdb or mmcif.".into());
    }
    let path = Path::new(&project.structure.path);
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|p| !matches!(p, Component::Normal(_)))
    {
        return Err("Structure path must be relative and stay inside the project folder.".into());
    }
    let mut ids = HashSet::new();
    let mut ranks = HashSet::new();
    for p in &project.pockets {
        let fail = |message: &str| format!("Pocket {}: {message}", p.id);
        if p.id.is_empty() || !ids.insert(&p.id) || p.rank == 0 || !ranks.insert(p.rank) {
            return Err(fail("IDs and positive ranks must be unique."));
        }
        if !p.center.iter().all(|n| n.is_finite()) {
            return Err(fail("Invalid center coordinates."));
        }
        if p.geometry.alpha_spheres.iter().any(|s| {
            s.radius <= 0. || !s.radius.is_finite() || !s.center.iter().all(|n| n.is_finite())
        }) {
            return Err(fail("Invalid alpha-sphere coordinates or radius."));
        }
        if p.fpocket
            .values()
            .chain(p.features.iter().map(|f| &f.value))
            .any(|v| !v.is_finite())
        {
            return Err(fail("Non-finite scientific value."));
        }
        if p.fpocket.get("Volume").is_some_and(|v| *v < 0.) {
            return Err(fail("Volume cannot be negative."));
        }
        if let Some(pred) = &p.prediction {
            if let Some(classes) = &pred.lipid_classes {
                let names = ["FattyAcyls", "Glycerolipids", "Glycerophospholipids", "Sphingolipids", "SterolLipids", "PrenolLipids", "Saccharolipids", "Polyketides"];
                if classes.taxonomy_version != "biodolphin_unique_values_to_canonical_v1"
                    || classes.scores.len() != names.len()
                    || names.iter().any(|name| classes.scores.get(*name).is_none_or(|v| !v.is_finite() || !(0.0..=1.0).contains(v)))
                { return Err(fail("Invalid canonical multilabel lipid-class scores.")); }
            }
            if project.model.version.as_deref().unwrap_or("").is_empty() {
                return Err(fail("Predictions require a model version."));
            }
            if !pred.probability.is_finite() || !(0.0..=1.0).contains(&pred.probability) {
                return Err(fail("Probability must lie in [0, 1]."));
            }
            if !project.model.classes.contains(&pred.label) {
                return Err(fail("Prediction label is not in model.classes."));
            }
            if !pred.probabilities.is_empty() {
                if pred.probabilities.len() != project.model.classes.len()
                    || pred.probabilities.iter().any(|(k, v)| {
                        !project.model.classes.contains(k)
                            || !v.is_finite()
                            || !(0.0..=1.0).contains(v)
                    })
                    || (pred.probabilities.values().sum::<f64>() - 1.).abs() > 0.001
                {
                    return Err(fail(
                        "Class probabilities must cover model.classes and sum to 1.",
                    ));
                }
                if (pred.probabilities[&pred.label] - pred.probability).abs() > 0.001 {
                    return Err(fail(
                        "Predicted class probability disagrees with probability vector.",
                    ));
                }
            }
        }
    }
    Ok(())
}

pub fn load(path: &Path) -> Result<LoadedProject, String> {
    let path = if path.is_dir() {
        path.join("studio.json")
    } else {
        path.to_path_buf()
    };
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("Could not read project {}: {e}", path.display()))?;
    let project: StudioProject =
        serde_json::from_str(&text).map_err(|e| format!("Invalid project JSON: {e}"))?;
    validate(&project)?;
    let root = path
        .parent()
        .unwrap_or(Path::new("."))
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let structure_path = root
        .join(&project.structure.path)
        .canonicalize()
        .map_err(|e| {
            format!(
                "Structure {} could not be loaded: {e}",
                project.structure.path
            )
        })?;
    if !structure_path.starts_with(&root) {
        return Err("Structure symlink points outside the project folder.".into());
    }
    let structure_data = fs::read_to_string(&structure_path)
        .map_err(|e| format!("Could not read structure: {e}"))?;
    assemble(project, structure_data)
}

fn assemble(mut project: StudioProject, structure_data: String) -> Result<LoadedProject, String> {
    let format = if project.structure.format == "pdb" {
        pdbtbx::Format::Pdb
    } else {
        pdbtbx::Format::Mmcif
    };
    let (pdb, issues) = pdbtbx::ReadOptions::new()
        .set_format(format)
        .set_level(pdbtbx::StrictnessLevel::Loose)
        .set_capitalise_chains(false)
        .set_only_first_model(true)
        .read_raw(std::io::BufReader::new(structure_data.as_bytes()))
        .map_err(|e| {
            format!(
                "Structure parse failed: {}",
                e.iter()
                    .take(3)
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("; ")
            )
        })?;
    if pdb.atom_count() == 0 {
        return Err("Structure contains no atoms.".into());
    }
    let residues: HashSet<Residue> = pdb
        .models()
        .take(1)
        .flat_map(|m| m.chains())
        .flat_map(|c| {
            c.residues().flat_map(move |r| {
                r.conformers().map(move |conf| Residue {
                    chain: c.id().into(),
                    seq: r.id().0 as i32,
                    name: conf.name().into(),
                    insertion_code: r.insertion_code().unwrap_or("").into(),
                })
            })
        })
        .collect();
    for p in &project.pockets {
        for r in &p.residues {
            if !residues.contains(r) {
                return Err(format!(
                    "Pocket {} references missing residue {}:{}{} {} in the first structure model.",
                    p.id, r.chain, r.seq, r.insertion_code, r.name
                ));
            }
        }
    }
    project.pockets.sort_by_key(|p| p.rank);
    let warnings = if issues.is_empty() {
        vec![]
    } else {
        vec![format!(
            "Structure reader reported {} format advisories; atomic coordinates loaded.",
            issues.len()
        )]
    };
    Ok(LoadedProject {
        project,
        structure_data,
        warnings,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureFile {
    pub path: String,
    pub name: String,
    pub format: String,
    pub size: u64,
}

fn coordinate_format(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "pdb" | "ent" => Some("pdb"),
        "cif" | "mmcif" => Some("mmcif"),
        _ => None,
    }
}

pub fn list_structures(root: &Path) -> Result<Vec<StructureFile>, String> {
    let root = root.canonicalize().map_err(|e| format!("Could not open folder: {e}"))?;
    if !root.is_dir() { return Err("Choose a folder of structures.".into()); }
    let mut pending = vec![root.clone()];
    let mut files = Vec::new();
    let mut visited = 0;
    while let Some(directory) = pending.pop() {
        visited += 1;
        if visited > 10_000 { return Err("This folder has over 10,000 subfolders. Choose a smaller library.".into()); }
        for entry in fs::read_dir(&directory).map_err(|e| format!("Could not read {}: {e}", directory.display()))? {
            let entry = entry.map_err(|e|e.to_string())?;
            let kind = entry.file_type().map_err(|e|e.to_string())?;
            // Follow real directories only; symlinks can leave the library or create cycles.
            if kind.is_dir() { pending.push(entry.path()); }
            else if kind.is_file() {
                let path = entry.path();
                if let Some(format) = coordinate_format(&path) {
                    if files.len() == 10_000 { return Err("This folder has over 10,000 structures. Choose a smaller library.".into()); }
                    files.push(StructureFile {
                        name: path.strip_prefix(&root).unwrap().to_string_lossy().into(),
                        path: path.to_string_lossy().into(), format: format.into(),
                        size: entry.metadata().map_err(|e|e.to_string())?.len(),
                    });
                }
            }
        }
    }
    files.sort_by(|a,b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then(a.name.cmp(&b.name)));
    Ok(files)
}

pub fn load_structure(path: &Path) -> Result<LoadedProject, String> {
    let format = coordinate_format(path).ok_or("Choose a PDB, ENT, CIF or mmCIF structure.")?;
    let path = path.canonicalize().map_err(|e| format!("Could not open structure: {e}"))?;
    let metadata = fs::metadata(&path).map_err(|e|e.to_string())?;
    if !metadata.is_file() || metadata.len() > 20_000_000 {
        return Err("Choose a structure file no larger than 20 MB.".into());
    }
    let structure_data = fs::read_to_string(&path).map_err(|e| format!("Could not read structure: {e}"))?;
    let name = path.file_stem().unwrap().to_string_lossy().to_string();
    let project = StudioProject {
        schema_version: 1, id: format!("structure:{}",path.display()), name: name.clone(),
        description: "Local coordinates · first model".into(),
        structure: Structure { id: name, path: path.file_name().unwrap().to_string_lossy().into(), format:format.into(), source:"Local structure file".into() },
        model: Model { name:"SLiPP++".into(), version:None, classes:vec![], calibration:"Not available".into() },
        provenance: "Imported coordinates. Pocket detection and model inference have not been run.".into(),
        pockets:vec![],
    };
    assemble(project,structure_data)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folder_library_and_raw_structures() {
        let root=std::env::temp_dir().join(format!("slipp-library-test-{}",std::process::id()));
        fs::create_dir_all(root.join("nested")).unwrap();
        let source=Path::new(env!("CARGO_MANIFEST_DIR")).join("../demo/canonical-project/structure.pdb");
        fs::copy(&source,root.join("b.PDB")).unwrap();
        fs::copy(&source,root.join("nested/a.ent")).unwrap();
        fs::write(root.join("notes.txt"),"ignored").unwrap();
        fs::write(root.join("bad.pdb"),"invalid coordinates").unwrap();
        #[cfg(unix)] std::os::unix::fs::symlink(&root,root.join("loop")).unwrap();
        let files=list_structures(&root).unwrap();
        assert_eq!(files.len(),3);
        assert!(files.iter().any(|f|f.name=="nested/a.ent"));
        let loaded=load_structure(&root.join("b.PDB")).unwrap();
        assert!(loaded.project.pockets.is_empty());
        assert!(loaded.structure_data.contains("ATOM"));
        assert_ne!(loaded.project.id,load_structure(&root.join("nested/a.ent")).unwrap().project.id);
        assert!(load_structure(&root.join("bad.pdb")).is_err());
        assert!(load_structure(&root.join("notes.txt")).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn bundled_lipid_reference_loads_with_predictions() {
        let path=Path::new(env!("CARGO_MANIFEST_DIR")).join("../demo/lipid-reference/studio.json");
        let loaded=load(&path).unwrap();
        assert_eq!(loaded.project.structure.id,"7T1M");
        assert!(!loaded.project.pockets.is_empty());
        assert!(loaded.project.pockets.iter().all(|p|p.prediction.is_some()));
        assert_eq!(loaded.project.model.name,"SLiPP");
        assert!(loaded.structure_data.lines().filter(|l|l.starts_with("HETATM")).all(|l|["HOH","CL"].contains(&l[17..20].trim())));
    }
    #[test]
    fn multilabel_scores_round_trip_without_distribution_normalization() {
        let root=Path::new(env!("CARGO_MANIFEST_DIR")).join("../demo/lipid-reference/studio.json");
        let mut project=load(&root).unwrap().project;
        let classes=LipidClasses {
            taxonomy_version:"biodolphin_unique_values_to_canonical_v1".into(),
            scores:["FattyAcyls", "Glycerolipids", "Glycerophospholipids", "Sphingolipids", "SterolLipids", "PrenolLipids", "Saccharolipids", "Polyketides"].into_iter().map(|s|(s.into(),0.7)).collect(),
        };
        project.pockets[0].prediction.as_mut().unwrap().lipid_classes=Some(classes);
        validate(&project).unwrap();
        let restored:StudioProject=serde_json::from_str(&serde_json::to_string(&project).unwrap()).unwrap();
        assert_eq!(restored.pockets[0].prediction.as_ref().unwrap().lipid_classes.as_ref().unwrap().scores["SterolLipids"],0.7);
        project.pockets[0].prediction.as_mut().unwrap().lipid_classes.as_mut().unwrap().scores.remove("SterolLipids");
        assert!(validate(&project).is_err());
    }
    #[test]
    fn canonical_project_and_validation_boundaries() {
        let root =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../demo/canonical-project/studio.json");
        let loaded = load(&root).unwrap();
        assert!(loaded.project.pockets.len() >= 3);
        assert!(loaded.structure_data.contains("ATOM"));
        let base = loaded.project;
        let mut p = base.clone();
        p.schema_version = 2;
        assert!(validate(&p).is_err());
        let mut p = base.clone();
        p.structure.path = "../escape.pdb".into();
        assert!(validate(&p).is_err());
        let mut p = base.clone();
        p.pockets[0].center[0] = f64::NAN;
        assert!(validate(&p).is_err());
        let mut p = base.clone();
        p.pockets[0].geometry.alpha_spheres[0].radius = -1.;
        assert!(validate(&p).is_err());
        let mut p = base.clone();
        p.pockets[1].id = p.pockets[0].id.clone();
        assert!(validate(&p).is_err());
        let mut p = base.clone();
        p.pockets[0].prediction = Some(Prediction {
            label: "PLM".into(),
            probability: 1.1,
            probabilities: BTreeMap::new(),
            lipid_classes: None,
        });
        assert!(validate(&p).is_err());
        let dir = std::env::temp_dir().join(format!("slipp-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::copy(
            root.parent().unwrap().join(&base.structure.path),
            dir.join(&base.structure.path),
        )
        .unwrap();
        let mut p = base.clone();
        p.pockets[0].residues[0].seq = 99999;
        fs::write(dir.join("studio.json"), serde_json::to_vec(&p).unwrap()).unwrap();
        assert!(load(&dir).unwrap_err().contains("missing residue"));
        fs::remove_file(dir.join(&base.structure.path)).unwrap();
        assert!(load(&dir).unwrap_err().contains("could not be loaded"));
        fs::remove_dir_all(dir).unwrap();
    }
}
