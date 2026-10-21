//! Sharing macros as files: the export format and the import rules.
//!
//! An export is a small JSON document anyone can pass around:
//!
//! ```jsonc
//! { "format": "pochini.macros", "version": 1, "macros": [ /* Macro */ ] }
//! ```
//!
//! Import also accepts a bare macro object and a `macros.json` backup, so a
//! hand-copied macro or a whole library comes in the same way. Imported
//! macros are new macros: fresh ids, and their **hotkey switched off**, so a
//! macro someone else wrote never fires on a key until its new owner has
//! looked at it and turned it on.

use crate::model::{Macro, MacroFile};

pub const FORMAT: &str = "pochini.macros";
pub const VERSION: u32 = 1;
/// A shared macro is a few kilobytes; anything near this is not one.
pub const MAX_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_MACROS: usize = 500;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ShareFile {
    pub format: String,
    pub version: u32,
    pub macros: Vec<Macro>,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ShareError {
    #[error("That file is too big to be a Pochini export.")]
    TooBig,
    #[error("That file is not a Pochini macro export.")]
    NotPochini,
    #[error("That export was made by a newer Pochini (format {0}). Update Pochini to import it.")]
    TooNew(u32),
    #[error("That export has no macros in it.")]
    Empty,
    #[error("That export has more than {MAX_MACROS} macros.")]
    TooMany,
    #[error("That export is damaged: {0}")]
    Invalid(String),
}

/// The file for `macros`. Personal list state (the star) stays behind.
pub fn export(macros: &[Macro]) -> String {
    let file = ShareFile {
        format: FORMAT.into(),
        version: VERSION,
        macros: macros
            .iter()
            .cloned()
            .map(|mut m| {
                m.favorite = false;
                m
            })
            .collect(),
    };
    // A Vec of plain data cannot fail to serialize.
    serde_json::to_string_pretty(&file).unwrap_or_default()
}

/// A file name for an export of `name`: Windows-safe, never empty.
pub fn file_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { ' ' } else { c })
        .collect();
    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let clean = clean.trim_matches('.');
    format!("{}.pochini.json", if clean.is_empty() { "macro" } else { clean })
}

/// Read an export (or a bare macro, or a macros.json backup) and turn its
/// macros into new macros for this library: fresh ids, hotkey off, not a
/// favorite, timestamps now, and a name that does not clash with
/// `existing_names` (" (imported)", " (imported 2)"...).
pub fn import(text: &str, existing_names: &[String], now: &str) -> Result<Vec<Macro>, ShareError> {
    if text.len() > MAX_BYTES {
        return Err(ShareError::TooBig);
    }
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| ShareError::NotPochini)?;
    let macros = if value.get("format").is_some() {
        if value["format"] != FORMAT {
            return Err(ShareError::NotPochini);
        }
        let version = value["version"].as_u64().unwrap_or(0) as u32;
        if version > VERSION {
            return Err(ShareError::TooNew(version));
        }
        serde_json::from_value::<ShareFile>(value).map_err(|e| ShareError::Invalid(e.to_string()))?.macros
    } else if value.get("schema_version").is_some() && value.get("macros").is_some() {
        serde_json::from_value::<MacroFile>(value).map_err(|e| ShareError::Invalid(e.to_string()))?.macros
    } else if value.get("steps").is_some() && value.get("name").is_some() {
        vec![serde_json::from_value::<Macro>(value).map_err(|e| ShareError::Invalid(e.to_string()))?]
    } else {
        return Err(ShareError::NotPochini);
    };
    if macros.is_empty() {
        return Err(ShareError::Empty);
    }
    if macros.len() > MAX_MACROS {
        return Err(ShareError::TooMany);
    }

    let mut taken: Vec<String> = existing_names.to_vec();
    Ok(macros
        .into_iter()
        .map(|mut m| {
            m.fresh_ids();
            m.enabled = false;
            m.favorite = false;
            m.created_at = now.into();
            m.updated_at = now.into();
            m.name = unique_name(m.name.trim(), &taken);
            taken.push(m.name.clone());
            m
        })
        .collect())
}

fn unique_name(name: &str, taken: &[String]) -> String {
    let name = if name.is_empty() { "Imported macro" } else { name };
    if !taken.iter().any(|t| t == name) {
        return name.into();
    }
    (1..)
        .map(|n| if n == 1 { format!("{name} (imported)") } else { format!("{name} (imported {n})") })
        .find(|c| !taken.contains(c))
        .unwrap_or_else(|| name.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Jitter, Step};

    const NOW: &str = "2026-10-12T12:00:00Z";

    fn sample(name: &str) -> Macro {
        let mut m = Macro::new(name);
        m.favorite = true;
        m.color = Some("teal".into());
        m.steps.push(Step::Wait { id: "w1".into(), shuffle: false, ms: Jitter::exact(100) });
        m.steps.push(Step::Wait { id: "w2".into(), shuffle: false, ms: Jitter::exact(200) });
        m
    }

    #[test]
    fn an_export_round_trips_into_new_macros() {
        let original = sample("Fill form");
        let text = export(std::slice::from_ref(&original));
        assert!(text.contains(r#""format": "pochini.macros""#), "{text}");

        let got = import(&text, &[], NOW).unwrap();
        assert_eq!(got.len(), 1);
        let m = &got[0];
        assert_eq!(m.name, "Fill form");
        assert_eq!(m.steps.len(), 2);
        assert_eq!(m.color.as_deref(), Some("teal"), "the color travels with it");
        assert_ne!(m.id, original.id, "a new macro, not the same one");
        assert!(!m.enabled, "hotkey off until its new owner turns it on");
        assert!(!m.favorite);
        assert_eq!(m.created_at, NOW);
    }

    #[test]
    fn imported_steps_get_fresh_unique_ids() {
        let got = import(&export(&[sample("a"), sample("b")]), &[], NOW).unwrap();
        let mut ids: Vec<String> = got.iter().flat_map(|m| m.steps.iter().map(|s| s.id().to_string())).collect();
        assert!(!ids.iter().any(|i| i == "w1" || i == "w2"));
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 4);
    }

    #[test]
    fn names_never_clash_with_the_library_or_each_other() {
        let text = export(&[sample("Fill"), sample("Fill")]);
        let got = import(&text, &["Fill".into(), "Fill (imported)".into()], NOW).unwrap();
        let names: Vec<&str> = got.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, ["Fill (imported 2)", "Fill (imported 3)"]);
    }

    #[test]
    fn a_bare_macro_and_a_macros_json_backup_import_too() {
        let bare = serde_json::to_string(&sample("Bare")).unwrap();
        assert_eq!(import(&bare, &[], NOW).unwrap()[0].name, "Bare");

        let f = MacroFile { macros: vec![sample("One"), sample("Two")], ..Default::default() };
        let backup = serde_json::to_string(&f).unwrap();
        assert_eq!(import(&backup, &[], NOW).unwrap().len(), 2);
    }

    #[test]
    fn files_that_are_not_exports_are_refused_with_a_reason() {
        assert_eq!(import("not json", &[], NOW), Err(ShareError::NotPochini));
        assert_eq!(import(r#"{"hello":1}"#, &[], NOW), Err(ShareError::NotPochini));
        assert_eq!(import(r#"{"format":"other","version":1,"macros":[]}"#, &[], NOW), Err(ShareError::NotPochini));
        assert_eq!(import(r#"{"format":"pochini.macros","version":9,"macros":[]}"#, &[], NOW), Err(ShareError::TooNew(9)));
        assert_eq!(import(r#"{"format":"pochini.macros","version":1,"macros":[]}"#, &[], NOW), Err(ShareError::Empty));
        assert!(matches!(
            import(r#"{"format":"pochini.macros","version":1,"macros":[{"id":"x"}]}"#, &[], NOW),
            Err(ShareError::Invalid(_))
        ));
        assert_eq!(import(&" ".repeat(MAX_BYTES + 1), &[], NOW), Err(ShareError::TooBig));
    }

    #[test]
    fn export_file_names_are_safe_on_windows() {
        assert_eq!(file_name("Fill form"), "Fill form.pochini.json");
        assert_eq!(file_name(r#"a/b\c:d*e?"f<g>h|"#), "a b c d e f g h.pochini.json");
        assert_eq!(file_name("..."), "macro.pochini.json");
        assert_eq!(file_name(""), "macro.pochini.json");
    }
}
