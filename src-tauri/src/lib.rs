mod docking;
mod project;

#[tauri::command]
async fn list_structures(path: String) -> Result<Vec<project::StructureFile>, String> {
    tauri::async_runtime::spawn_blocking(move || project::list_structures(std::path::Path::new(&path))).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn open_structure(path: String) -> Result<project::LoadedProject, String> {
    tauri::async_runtime::spawn_blocking(move || project::load_structure(std::path::Path::new(&path))).await.map_err(|e|e.to_string())?
}

use tauri::Manager;
#[tauri::command]
fn open_project(path: String) -> Result<project::LoadedProject, String> {
    project::load(std::path::Path::new(&path))
}
#[tauri::command]
fn open_demo(app: tauri::AppHandle) -> Result<project::LoadedProject, String> {
    let path = app
        .path()
        .resolve(
            "demo/lipid-reference/studio.json",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| e.to_string())?;
    project::load(&path)
}
#[tauri::command]
fn save_export(path: String, bytes: Vec<u8>) -> Result<(), String> {
    use std::io::Write;
    let destination=std::path::Path::new(&path);
    let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e|e.to_string())?.as_nanos();
    let temporary=destination.with_extension(format!("slipp-{stamp}.tmp"));
    let result=(||->std::io::Result<()>{
        let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(&bytes)?;file.sync_all()?;
        std::fs::rename(&temporary,destination)
    })();
    if result.is_err(){let _=std::fs::remove_file(temporary);}
    result.map_err(|e|format!("Could not export to {path}: {e}"))
}
#[tauri::command]
async fn read_workspace(path:String)->Result<String,String>{
    tauri::async_runtime::spawn_blocking(move||{
        let metadata=std::fs::metadata(&path).map_err(|e|e.to_string())?;
        if !metadata.is_file()||metadata.len()>250_000_000{return Err("Workspace exceeds 250 MB.".into());}
        std::fs::read_to_string(path).map_err(|e|e.to_string())
    }).await.map_err(|e|e.to_string())?
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(docking::DockingJob::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let _ = docking::cancel_docking(window.state::<docking::DockingJob>());
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_project,
            read_workspace,
            list_structures,
            open_structure,
            open_demo,
            save_export,
            docking::docking_status,
            docking::science_status,
            docking::run_docking,
            docking::cancel_docking
        ])
        .run(tauri::generate_context!())
        .expect("Could not start SLiPP Studio");
}
