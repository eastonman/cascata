import "./style.css";
import { App } from "./ui/app";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("#app not found");

new App(root).start();
