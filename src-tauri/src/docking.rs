use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    process::{Command, Stdio},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

#[derive(Default)]
pub struct DockingJob(pub Mutex<Option<PathBuf>>);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockingRequest {
    #[serde(default)]
    smiles: String,
    #[serde(default = "default_action")]
    action: String,
    #[serde(default = "default_scoring")]
    scoring: String,
    #[serde(default = "default_inference_model")]
    inference_model: String,
    #[serde(default)]
    preparation: serde_json::Value,
    #[serde(default)]
    source: String,
    #[serde(default)]
    structure_data: String,
    #[serde(default)]
    format: String,
    pocket: Option<crate::project::Pocket>,
    #[serde(default)]
    seed: u32,
    #[serde(default)]
    exhaustiveness: u32,
    #[serde(default)]
    cpu: usize,
}

fn default_action() -> String { "dock".into() }
fn default_scoring() -> String { "vina".into() }
fn default_inference_model() -> String { "slipp".into() }

fn python(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("SLIPP_DOCKING_PYTHON") {
        return Ok(path.into());
    }
    let config = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("docking-runtime.json");
    if let Ok(text) = fs::read_to_string(config) {
        let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        if let Some(path) = value["python"].as_str() {
            return Ok(path.into());
        }
    }
    Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.venv-docking/bin/python"))
}

#[tauri::command]
pub fn docking_status(app: tauri::AppHandle) -> Result<bool, String> {
    let p = python(&app)?;
    Ok(p.is_file() && p.parent().is_some_and(|d| d.join("vina").is_file()))
}

#[tauri::command]
pub fn cancel_docking(job: tauri::State<'_, DockingJob>) -> Result<(), String> {
    if let Some(path) = job.0.lock().map_err(|e| e.to_string())?.as_ref() {
        fs::write(path.join("cancel"), "").map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn validate(request: &DockingRequest) -> Result<(), String> {
    if request.action == "fetch" {
        return if !request.source.is_empty() && request.source.len() <= 2048 { Ok(()) } else { Err("Invalid PDB ID or link.".into()) };
    }
    if !["inspect", "prepare", "dock", "analyze"].contains(&request.action.as_str())
        || !["vina", "vinardo"].contains(&request.scoring.as_str())
        || !["slipp", "saprot-egnn-fold2"].contains(&request.inference_model.as_str())
        || !["pdb", "mmcif"].contains(&request.format.as_str())
        || request.structure_data.is_empty() || request.structure_data.len() > 20_000_000
        || serde_json::to_vec(&request.preparation).map_err(|e|e.to_string())?.len() > 200_000
    { return Err("Invalid workbench request.".into()); }
    if request.action != "dock" { return Ok(()); }
    if request.smiles.trim().is_empty()
        || request.smiles.len() > 2048
        || request.structure_data.len() > 20_000_000
    {
        return Err("Invalid SMILES or receptor input size.".into());
    }
    if !["pdb", "mmcif"].contains(&request.format.as_str())
        || !(1..=128).contains(&request.exhaustiveness)
        || !(1..=2_147_483_647).contains(&request.seed)
    {
        return Err("Invalid docking format or search settings.".into());
    }
    let spheres = &request.pocket.as_ref().ok_or("Select a pocket.")?.geometry.alpha_spheres;
    if spheres.is_empty()
        || spheres.len() > 50_000
        || spheres.iter().any(|s| {
            s.radius <= 0. || !s.radius.is_finite() || s.center.iter().any(|n| !n.is_finite())
        })
    {
        return Err("Invalid pocket geometry for docking.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn run_docking(
    app: tauri::AppHandle,
    mut request: DockingRequest,
) -> Result<serde_json::Value, String> {
    validate(&request)?;
    let python = python(&app)?;
    if !python.is_file() {
        return Err(
            "Scientific runtime is missing. Run scripts/setup-science.sh in the repository.".into(),
        );
    }
    // Leave two cores for rendering and the OS; Vina owns parallel search internally.
    request.cpu = std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(2).clamp(1, 12))
        .unwrap_or(1);
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("docking");
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let directory = base.join(format!("job-{id}"));
    {
        let state = app.state::<DockingJob>();
        let mut job = state.0.lock().map_err(|e| e.to_string())?;
        if job.is_some() {
            return Err("Another scientific operation is running. Wait for it or cancel it first.".into());
        }
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        *job = Some(directory.clone());
    }
    let work_dir = directory.clone();
    let work_app = app.clone();
    let started = std::time::Instant::now();
    let result =
        tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
            let script = work_app
                .path()
                .resolve("docking/run.py", tauri::path::BaseDirectory::Resource)
                .map_err(|e| e.to_string())?;
            let mut child = Command::new(python)
                .arg(script)
                .arg(&work_dir)
                .arg(base.join("receptors"))
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Could not start docking: {e}"))?;
            use std::io::Write;
            let input = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
            if let Err(error) = child.stdin.take().unwrap().write_all(&input) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Could not send docking input: {error}"));
            }
            let output = child.wait_with_output().map_err(|e| e.to_string())?;
            let value: serde_json::Value =
                serde_json::from_slice(&output.stdout).map_err(|_| {
                    format!(
                        "Docking runtime failed: {}",
                        String::from_utf8_lossy(&output.stderr)
                            .chars()
                            .take(4000)
                            .collect::<String>()
                    )
                })?;
            if let Some(error) = value["error"].as_str() {
                return Err(error.to_owned());
            }
            if !output.status.success() {
                return Err("Docking process failed.".into());
            }
            Ok(value)
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    if let Ok(mut job) = app.state::<DockingJob>().0.lock() {
        *job = None;
    }
    let _ = fs::remove_dir_all(directory);
    result.map(|mut value| {
        value["wallSeconds"] = serde_json::json!(started.elapsed().as_secs_f64());
        value
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_search_before_starting_worker() {
        let loaded = crate::project::load(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../demo/canonical-project/studio.json"),
        )
        .unwrap();
        let mut r = DockingRequest {
            smiles: "CCO".into(), source: String::new(),
            action: default_action(), scoring: default_scoring(), inference_model: default_inference_model(), preparation: serde_json::json!({}),
            structure_data: loaded.structure_data,
            format: "pdb".into(),
            pocket: Some(loaded.project.pockets[0].clone()),
            seed: 2026,
            exhaustiveness: 8,
            cpu: 1,
        };
        assert!(validate(&r).is_ok());
        r.exhaustiveness = 0;
        assert!(validate(&r).is_err());
        r.exhaustiveness = 8;
        r.pocket.as_mut().unwrap().geometry.alpha_spheres[0].radius = f64::NAN;
        assert!(validate(&r).is_err());
    }
}

#[tauri::command]
pub fn science_status(app: tauri::AppHandle) -> Result<bool, String> {
    let p=python(&app)?;
    Ok(p.is_file() && p.parent().is_some_and(|d|d.join("fpocket").is_file()))
}
