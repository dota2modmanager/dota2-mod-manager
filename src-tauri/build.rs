fn main() {
    // the page's api is preload.js itself (src/bridge.js): a change to it is a change to the binary
    println!("cargo:rerun-if-changed=../preload.js");
    println!("cargo:rerun-if-changed=src/bridge.js");
    tauri_build::build()
}
