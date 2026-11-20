fn main() {
    // the page scripts are built into the binary (main.rs page_script): a change to one is a change to it
    println!("cargo:rerun-if-changed=src/page");
    delay_load_common_controls();
    tauri_build::build()
}

/// Tauri, muda and rfd import TaskDialogIndirect from comctl32.dll, which only the version 6
/// assembly exports. Where Windows hands the process the old comctl32 (a stripped Windows
/// build, a compatibility mode), a plain import stops the exe before main with "The procedure
/// entry point TaskDialogIndirect could not be located". Loading comctl32 on first use moves
/// that to the one message dialog that needs it, and the window still opens.
/// CI checks the built exe's import table (tools/dev/pe-imports.mjs in e2e.yml).
fn delay_load_common_controls() {
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    let abi = std::env::var("CARGO_CFG_TARGET_ABI").unwrap_or_default();
    if os != "windows" {
        return;
    }
    if env == "msvc" {
        println!("cargo:rustc-link-arg-bins=/DELAYLOAD:comctl32.dll");
        println!("cargo:rustc-link-arg-bins=delayimp.lib");
    } else if abi == "llvm" {
        // llvm-mingw's lld (x86_64-pc-windows-gnullvm); GNU ld has no delay loading
        println!("cargo:rustc-link-arg-bins=-Wl,--delayload=comctl32.dll");
        println!("cargo:rustc-link-arg-bins=-ldelayimp");
    }
}
