fn main() {
    // The Windows resource compiler must rerun when only the icon changes.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // Integration-test EXEs do not inherit tauri-build's binary resource.
        // Tao imports ComCtl32 v6 APIs, so they need the same activation context.
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rerun-if-changed=tests/runtime.manifest");
        println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}/tests/runtime.manifest", std::env::var("CARGO_MANIFEST_DIR").unwrap());
    }
}
