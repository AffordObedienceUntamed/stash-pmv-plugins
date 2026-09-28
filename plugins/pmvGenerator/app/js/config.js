// Standalone PMV Generator: tell the shared generator module which plugin backend saves
// recordings and where a saved scene opens (classic Stash).
window.PMVGEN_PLUGIN = "pmvGenerator";
window.PMVGEN_SCENE_LINK = (id) => "/scenes/" + id;
