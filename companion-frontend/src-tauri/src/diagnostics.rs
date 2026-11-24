//! Lifecycle diagnostics only: never record chat, command arguments or keys.
use std::{io::Write, path::PathBuf, sync::{Mutex, OnceLock}};

static LOG: OnceLock<Mutex<PathBuf>> = OnceLock::new();

pub fn initialize(directory: &std::path::Path) {
    let _ = LOG.set(Mutex::new(directory.join("desktop-lifecycle.log")));
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(location) = info.location() {
            record(&format!("rust panic at {}:{}", location.file(), location.line()));
        } else {
            record("rust panic (location unavailable)");
        }
        previous(info);
    }));
    record("desktop setup");
}

pub fn record(event: &str) {
    let Some(log) = LOG.get() else { return };
    let Ok(path) = log.lock() else { return };
    // Bound diagnostics so a long-running desktop session cannot fill the disk.
    if std::fs::metadata(&*path).map(|m| m.len() > 1_048_576).unwrap_or(false) {
        let _ = std::fs::rename(&*path, path.with_extension("previous.log"));
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&*path) {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
        let _ = writeln!(file, "{timestamp} pid={} {event}", std::process::id());
    }
}
