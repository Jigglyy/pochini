//! Macro and settings persistence.
//!
//! Writes are atomic (temp + fsync + rename) with a `.bak` of the previous
//! version. Losing a user's whole macro library to a crash during save is not
//! acceptable for a file this small.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::model::{MacroFile, Settings, SCHEMA_VERSION};

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("malformed json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("macros.json is schema version {found}, which this build ({expected}) cannot read")]
    TooNew { found: u32, expected: u32 },
}

pub type Result<T> = std::result::Result<T, StorageError>;

pub fn now_iso8601() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| String::from("1970-01-01T00:00:00Z"))
}

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn macros_path(&self) -> PathBuf {
        self.dir.join("macros.json")
    }

    pub fn settings_path(&self) -> PathBuf {
        self.dir.join("settings.json")
    }

    /// Load macros, migrating older schema versions forward.
    ///
    /// A missing file is an empty library, not an error. A *corrupt* file is
    /// preserved as `.corrupt-<timestamp>` rather than overwritten, because the
    /// user may be able to salvage it by hand.
    pub fn load_macros(&self) -> Result<MacroFile> {
        let mut path = self.macros_path();
        if !path.exists() {
            // A save interrupted by an older build (see atomic_write) could
            // leave only the backup: recover from it rather than start empty.
            let bak = path.with_extension("bak");
            if !bak.exists() {
                return Ok(MacroFile::default());
            }
            path = bak;
        }
        let text = fs::read_to_string(&path)?;
        match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(v) => migrate(v),
            Err(e) => {
                let quarantine = self
                    .dir
                    .join(format!("macros.json.corrupt-{}", now_iso8601().replace(':', "-")));
                let _ = fs::copy(&path, &quarantine);
                Err(StorageError::Json(e))
            }
        }
    }

    pub fn save_macros(&self, f: &MacroFile) -> Result<()> {
        let mut f = f.clone();
        f.schema_version = SCHEMA_VERSION;
        atomic_write(&self.macros_path(), &serde_json::to_vec_pretty(&f)?)
    }

    pub fn load_settings(&self) -> Result<Settings> {
        let path = self.settings_path();
        if !path.exists() {
            return Ok(Settings::default());
        }
        // Settings live in their own file so a corrupt macro library cannot
        // take the app down with it, and vice versa: fall back to defaults.
        Ok(serde_json::from_str(&fs::read_to_string(&path)?).unwrap_or_default())
    }

    pub fn save_settings(&self, s: &Settings) -> Result<()> {
        atomic_write(&self.settings_path(), &serde_json::to_vec_pretty(s)?)
    }
}

/// The config folder used before the app was renamed to Pochini.
pub const LEGACY_DIR_NAME: &str = "com.coordsclickermacro.app";

/// On the first start after the rename, copy the user's files from the old
/// config folder into the new one. Copies rather than moves (the old folder is
/// a free backup), never overwrites, and does nothing once the new folder has
/// data. Returns the names of the files it copied.
pub fn migrate_legacy_dir(new_dir: &Path, legacy_dir: &Path) -> std::io::Result<Vec<&'static str>> {
    let mut copied = Vec::new();
    if !legacy_dir.is_dir()
        || new_dir.join("macros.json").exists()
        || new_dir.join("settings.json").exists()
    {
        return Ok(copied);
    }
    fs::create_dir_all(new_dir)?;
    for name in ["macros.json", "macros.bak", "settings.json"] {
        let src = legacy_dir.join(name);
        if src.is_file() {
            fs::copy(&src, new_dir.join(name))?;
            copied.push(name);
        }
    }
    Ok(copied)
}

fn migrate(v: serde_json::Value) -> Result<MacroFile> {
    let found = v.get("schema_version").and_then(|x| x.as_u64()).unwrap_or(1) as u32;
    if found > SCHEMA_VERSION {
        return Err(StorageError::TooNew {
            found,
            expected: SCHEMA_VERSION,
        });
    }
    // v1 is current. Future versions add arms here, oldest first, each one
    // upgrading `v` in place before the final deserialize.
    Ok(serde_json::from_value(v)?)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    // Keep the previous version as .bak by copying, then replace the file in
    // one step (MoveFileExW with REPLACE_EXISTING on Windows). The file must
    // never be missing, even for a moment: moving it aside first left a
    // window where a crash meant an empty library on the next start.
    if path.exists() {
        let _ = fs::copy(path, path.with_extension("bak"));
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Jitter, Macro, Step};

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ccm-test-{tag}-{}", ulid::Ulid::new()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn legacy_files_are_copied_on_first_start_after_the_rename() {
        let legacy = tmpdir("legacy");
        let fresh = tmpdir("fresh").join("com.pochini.app");
        fs::write(legacy.join("macros.json"), br#"{"schema_version":1,"macros":[]}"#).unwrap();
        fs::write(legacy.join("settings.json"), b"{}").unwrap();
        fs::write(legacy.join("macros.bak"), b"old").unwrap();

        let copied = migrate_legacy_dir(&fresh, &legacy).unwrap();
        assert_eq!(copied, vec!["macros.json", "macros.bak", "settings.json"]);
        assert!(fresh.join("macros.json").exists());
        // copied, not moved: the old folder is left intact
        assert!(legacy.join("macros.json").exists());
    }

    #[test]
    fn migration_never_overwrites_existing_data() {
        let legacy = tmpdir("legacy2");
        let fresh = tmpdir("fresh2");
        fs::write(legacy.join("macros.json"), b"LEGACY").unwrap();
        fs::write(fresh.join("macros.json"), b"CURRENT").unwrap();
        assert!(migrate_legacy_dir(&fresh, &legacy).unwrap().is_empty());
        assert_eq!(fs::read(fresh.join("macros.json")).unwrap(), b"CURRENT");
    }

    #[test]
    fn migration_without_a_legacy_folder_is_a_no_op() {
        let fresh = tmpdir("fresh3");
        let nowhere = fresh.join("does-not-exist");
        assert!(migrate_legacy_dir(&fresh, &nowhere).unwrap().is_empty());
    }

    #[test]
    fn missing_file_loads_as_an_empty_library() {
        let s = Store::new(tmpdir("missing"));
        let f = s.load_macros().unwrap();
        assert!(f.macros.is_empty());
        assert_eq!(f.schema_version, SCHEMA_VERSION);
    }

    #[test]
    fn save_then_load_roundtrips() {
        let d = tmpdir("roundtrip");
        let s = Store::new(&d);
        let mut f = MacroFile::default();
        let mut m = Macro::new("Harvest");
        m.steps.push(Step::Wait {
            id: "w".into(),
            ms: Jitter { base: 100, jitter: 25 },
        });
        f.macros.push(m);
        s.save_macros(&f).unwrap();

        let back = s.load_macros().unwrap();
        assert_eq!(back.macros.len(), 1);
        assert_eq!(back.macros[0].name, "Harvest");
        assert_eq!(back.macros[0].duration_range(), (100, 125));
    }

    #[test]
    fn a_second_save_leaves_the_previous_version_as_bak() {
        let d = tmpdir("bak");
        let s = Store::new(&d);
        let mut f = MacroFile::default();
        f.macros.push(Macro::new("first"));
        s.save_macros(&f).unwrap();
        f.macros[0].name = "second".into();
        s.save_macros(&f).unwrap();

        let bak = d.join("macros.bak");
        assert!(bak.exists(), "expected a .bak alongside macros.json");
        let prev: MacroFile = serde_json::from_str(&fs::read_to_string(bak).unwrap()).unwrap();
        assert_eq!(prev.macros[0].name, "first");
        assert_eq!(s.load_macros().unwrap().macros[0].name, "second");
        // No temp file left behind.
        assert!(!d.join("macros.tmp").exists());
    }

    /// Regression: a save used to rename macros.json to macros.bak before
    /// putting the new file in place, so for a moment there was no
    /// macros.json. A crash there started the next run with an empty library,
    /// and the save after that overwrote the backup with it.
    #[test]
    fn a_missing_macros_json_is_recovered_from_the_backup() {
        let d = tmpdir("recover");
        let s = Store::new(&d);
        let mut f = MacroFile::default();
        f.macros.push(Macro::new("keep me"));
        s.save_macros(&f).unwrap();
        s.save_macros(&f).unwrap(); // now macros.bak exists too
        fs::remove_file(d.join("macros.json")).unwrap(); // the crash window

        let back = s.load_macros().unwrap();
        assert_eq!(back.macros.len(), 1);
        assert_eq!(back.macros[0].name, "keep me");
    }

    #[test]
    fn saving_never_leaves_the_library_without_macros_json() {
        let d = tmpdir("never-missing");
        let s = Store::new(&d);
        let mut f = MacroFile::default();
        f.macros.push(Macro::new("v1"));
        s.save_macros(&f).unwrap();

        // Watch the file from another thread while saving repeatedly.
        let path = d.join("macros.json");
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (p2, stop2) = (path.clone(), stop.clone());
        let watcher = std::thread::spawn(move || {
            let mut missing = 0;
            while !stop2.load(std::sync::atomic::Ordering::Relaxed) {
                if !p2.exists() {
                    missing += 1;
                }
            }
            missing
        });
        for i in 0..200 {
            f.macros[0].name = format!("v{i}");
            s.save_macros(&f).unwrap();
        }
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        assert_eq!(watcher.join().unwrap(), 0, "macros.json went missing during a save");
        assert_eq!(s.load_macros().unwrap().macros[0].name, "v199");
    }

    #[test]
    fn a_corrupt_file_is_quarantined_rather_than_silently_replaced() {
        let d = tmpdir("corrupt");
        let s = Store::new(&d);
        fs::write(s.macros_path(), b"{ this is not json").unwrap();
        assert!(matches!(s.load_macros(), Err(StorageError::Json(_))));
        let quarantined: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("corrupt-"))
            .collect();
        assert_eq!(quarantined.len(), 1, "the bad file should be preserved");
        // And the original is still there for the user to inspect.
        assert!(s.macros_path().exists());
    }

    #[test]
    fn a_newer_schema_version_is_refused_rather_than_misread() {
        let d = tmpdir("toonew");
        let s = Store::new(&d);
        fs::write(
            s.macros_path(),
            br#"{"schema_version": 99, "macros": []}"#,
        )
        .unwrap();
        match s.load_macros() {
            Err(StorageError::TooNew { found, expected }) => {
                assert_eq!((found, expected), (99, SCHEMA_VERSION));
            }
            other => panic!("expected TooNew, got {other:?}"),
        }
    }

    #[test]
    fn settings_fall_back_to_defaults_when_unreadable() {
        let d = tmpdir("settings");
        let s = Store::new(&d);
        fs::write(s.settings_path(), b"garbage").unwrap();
        let loaded = s.load_settings().unwrap();
        assert_eq!(loaded, Settings::default());

        let custom = Settings { enabled: false, ..Default::default() };
        s.save_settings(&custom).unwrap();
        assert_eq!(s.load_settings().unwrap(), custom);
    }
}
