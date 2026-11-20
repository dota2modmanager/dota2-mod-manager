//! What hero_preview::model exports: a model of the game, never a path out of models/.

use super::*;
use std::cell::RefCell;

struct Asked(RefCell<Vec<String>>);
impl Exporter for Asked {
    fn glbs(&self, models: &[String], _: &Clips, _: bool) -> IndexMap<String, Option<PathBuf>> {
        self.0.borrow_mut().extend(models.iter().cloned());
        models.iter().map(|m| (m.clone(), None)).collect()
    }
    fn sprites(&self, _: &[String]) -> Option<IndexMap<String, Option<Vec<u8>>>> {
        None
    }
}

#[test]
fn a_worn_piece_is_exported_and_a_path_out_of_models_is_not() {
    let asked = Asked(RefCell::new(vec![]));
    for f in [
        "models/heroes/mars/mars_lower_debut.vmdl",
        "models/props_tree/tree_oak.vmdl",
        "models/../cfg/autoexec.vmdl",
        "models/heroes/./x.vmdl",
        "materials/x.vmdl",
    ] {
        assert!(model(&asked, f).unwrap().is_none());
    }
    assert_eq!(*asked.0.borrow(), ["models/heroes/mars/mars_lower_debut.vmdl", "models/props_tree/tree_oak.vmdl"]);
}
