/**
 * The stage, reusable by Allestimento, Banco and Show: views (3D with three.js, 2D in SVG), the geometry of lights,
 * beams and trusses, and the contract of the mouse. Independent from the screens and the stores: give it the document,
 * the 512 values to show and the handlers.
 */
export { StageView, webglAvailable, type StageViewHostProps } from "./StageView";
export { StageView2D } from "./StageView2D";
export * from "./types";
export * from "./geometry";
export { stageLights, sceneryOnStage, lightValues, lightLabel, warmWhenDimmed, hasColourChannels, type StageDoc, type StageLight } from "./scene";
