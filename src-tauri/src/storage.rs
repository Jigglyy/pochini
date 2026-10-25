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

/// The library as startup found it.
pub struct Opened {
    pub file: MacroFile,
    pub problem: Option<LoadProblem>,
}

/// Why `macros.json` could not be read, for the banner in the UI.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct LoadProblem {
    pub reason: String,
    /// Where the unreadable file was copied, untouched.
    pub kept_at: Option<String>,
    /// The library came from `macros.bak`, the version before the last save.
    pub from_backup: bool,
    /// Nothing could be read: saving is refused until the user chooses to
    /// start over, so the file they may still want is never written over.
    pub locked: bool,
}

fn read_macros(path: &Path) -> Result<MacroFile> {
    let text = fs::read_to_string(path)?;
    migrate(serde_json::from_str::<serde_json::Value>(&text)?)
}

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

    /// Open the library at startup. Never fails: when `macros.json` cannot be
    /// read, the reason comes back as a [`LoadProblem`] for the UI, a copy of
    /// the file is kept beside it, and the backup from before the last save is
    /// loaded if that one reads. If nothing reads, the library starts empty
    /// and `locked`: the app must not save until the user says so, or the next
    /// two saves would replace both the file and its backup with nothing.
    pub fn open_macros(&self) -> Opened {
        let path = self.macros_path();
        let err = match self.load_macros() {
            Ok(file) => return Opened { file, problem: None },
            Err(e) => e,
        };
        let kept_at = path.exists().then(|| self.keep_unreadable(&path)).flatten();
        let reason = err.to_string();
        // A library from a newer Pochini is not damaged, and its backup is
        // most likely from that version too: never fall back past it.
        if !matches!(err, StorageError::TooNew { .. }) {
            let bak = path.with_extension("bak");
            if let Ok(file) = read_macros(&bak) {
                return Opened {
                    file,
                    problem: Some(LoadProblem { reason, kept_at, from_backup: true, locked: false }),
                };
            }
        }
        Opened {
            file: MacroFile::default(),
            problem: Some(LoadProblem { reason, kept_at, from_backup: false, locked: true }),
        }
    }

    /// Copy an unreadable library aside as `macros.json.unreadable-<time>`.
    fn keep_unreadable(&self, path: &Path) -> Option<String> {
        let kept = self
            .dir
            .join(format!("macros.json.unreadable-{}", now_iso8601().replace(':', "-")));
        fs::copy(path, &kept).ok().map(|_| kept.display().to_string())
    }

    /// Load macros, migrating older schema versions forward.
    ///
    /// A missing file is an empty library, not an error; a missing file with a
    /// backup beside it is recovered from the backup. Anything unreadable is
    /// an error: see [`Store::open_macros`] for what startup does with it.
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
        read_macros(&path)
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
    // Each version that changed something adds an arm here, oldest first,
    // upgrading `v` in place before the final deserialize. 1 -> 2 only added
    // a step type and 2 -> 3 an anchor, so older files read as is; the next
    // save writes the current version.
    let _ = found;
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
            shuffle: false,
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

    fn kept_copies(d: &Path) -> Vec<PathBuf> {
        fs::read_dir(d)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.to_string_lossy().contains("unreadable-"))
            .collect()
    }

    #[test]
    fn a_corrupt_file_is_kept_rather_than_silently_replaced() {
        let d = tmpdir("corrupt");
        let s = Store::new(&d);
        fs::write(s.macros_path(), b"{ this is not json").unwrap();
        assert!(matches!(s.load_macros(), Err(StorageError::Json(_))));
        let o = s.open_macros();
        let p = o.problem.expect("a problem to show");
        assert!(p.locked, "no backup to fall back on, so nothing may be saved");
        assert_eq!(kept_copies(&d).len(), 1, "the bad file should be preserved");
        assert_eq!(p.kept_at.as_deref(), Some(kept_copies(&d)[0].to_string_lossy().as_ref()));
        // And the original is still there for the user to inspect.
        assert!(s.macros_path().exists());
    }

    /// Regression: only a JSON syntax error used to be kept. A file that was
    /// valid JSON but not a library this build understands (an unknown step
    /// type, a bad field) started an empty library with no copy, and two
    /// saves later the file and its backup were both empty.
    #[test]
    fn a_library_with_a_step_this_build_cannot_read_is_kept_and_the_backup_loads() {
        let d = tmpdir("unknown-step");
        let s = Store::new(&d);
        let mut f = MacroFile::default();
        f.macros.push(Macro::new("from the backup"));
        fs::write(d.join("macros.bak"), serde_json::to_vec(&f).unwrap()).unwrap();
        fs::write(
            s.macros_path(),
            br#"{"schema_version":1,"macros":[{"id":"m","name":"x","steps":[{"type":"teleport","id":"s"}]}]}"#,
        )
        .unwrap();

        let o = s.open_macros();
        assert_eq!(o.file.macros[0].name, "from the backup");
        let p = o.problem.expect("the UI must hear about it");
        assert!(p.from_backup && !p.locked, "{p:?}");
        assert_eq!(kept_copies(&d).len(), 1);
        assert!(fs::read_to_string(&kept_copies(&d)[0]).unwrap().contains("teleport"));
    }

    #[test]
    fn a_library_from_a_newer_version_locks_saving_and_never_uses_the_backup() {
        let d = tmpdir("newer");
        let s = Store::new(&d);
        let mut old = MacroFile::default();
        old.macros.push(Macro::new("older copy"));
        fs::write(d.join("macros.bak"), serde_json::to_vec(&old).unwrap()).unwrap();
        fs::write(s.macros_path(), br#"{"schema_version": 99, "macros": []}"#).unwrap();

        let o = s.open_macros();
        assert!(o.file.macros.is_empty());
        let p = o.problem.unwrap();
        assert!(p.locked && !p.from_backup, "{p:?}");
        assert!(p.reason.contains("99"), "{}", p.reason);
        assert_eq!(kept_copies(&d).len(), 1);
    }

    #[test]
    fn a_readable_library_opens_without_a_problem() {
        let d = tmpdir("fine");
        let s = Store::new(&d);
        let mut f = MacroFile::default();
        f.macros.push(Macro::new("ok"));
        s.save_macros(&f).unwrap();
        let o = s.open_macros();
        assert!(o.problem.is_none());
        assert_eq!(o.file.macros.len(), 1);
        assert!(kept_copies(&d).is_empty());
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
    fn a_version_1_library_reads_and_saves_as_the_current_version() {
        let d = tmpdir("v1");
        let s = Store::new(&d);
        fs::write(s.macros_path(), br#"{"schema_version":1,"macros":[{"id":"m","name":"old","trigger":null}]}"#).unwrap();
        let f = s.load_macros().unwrap();
        assert_eq!(f.macros[0].name, "old");
        s.save_macros(&f).unwrap();
        let raw: serde_json::Value = serde_json::from_str(&fs::read_to_string(s.macros_path()).unwrap()).unwrap();
        assert_eq!(raw["schema_version"], SCHEMA_VERSION);
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
