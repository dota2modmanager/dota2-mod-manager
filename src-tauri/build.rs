fn main() {
    // the page scripts are built into the binary (main.rs page_script): a change to one is a change to it
    println!("cargo:rerun-if-changed=src/page");
    tauri_build::build()
}
