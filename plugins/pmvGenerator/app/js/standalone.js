// Entry point of the standalone PMV Generator page.
import "./config.js";
import { applyTheme } from "./theme.js";
import { render } from "./views/pmvgen.js";

applyTheme(); // same colors as in Stash UI (same browser storage)
render(document.getElementById("main"));
